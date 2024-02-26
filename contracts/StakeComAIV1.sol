// SPDX-License-Identifier: MIT

/*
    Stake wrapped CommuneAI tokens to earn native yield rewards.
    https://stake.com.ai
*/

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/Address.sol";

interface IComBridge {
	function bridgeBack(uint256 amount, string memory to) external;
}

contract StakeComAIV1 is ReentrancyGuard, Ownable {
	using ECDSA for bytes32;
	using MessageHashUtils for bytes32;
	using Address for address;

	IERC20 public wComToken;
	IComBridge public comBridge;

	struct Stakers {
		uint256 amount;
		string communeAddress;
		string validator;
	}

	mapping(address => Stakers) public stakers;
	string public defaultValidator;
	address public signer;
	bool public allowCustomValidator = false;
  uint256 public totalStaked;
  bool public stakingPaused;

	event Staked(
		address indexed user,
		uint256 amount,
		string communeAddress,
		string validator
	);
	event InitUnstake(
		address indexed user,
		uint256 amount,
		uint256 amountBeforeUnstake,
		bool unstakeAll
	);
	event ValidatorChanged(address indexed user, string newValidator);

	constructor(
		address _wComAddress,
		address _bridgeAddress,
		string memory _defaultValidator
	) Ownable(msg.sender) {
		require(_wComAddress != address(0), "wComToken address cannot be 0");
		require(_bridgeAddress != address(0), "comBridge address cannot be 0");

		wComToken = IERC20(_wComAddress);
		comBridge = IComBridge(_bridgeAddress);
		defaultValidator = _defaultValidator;
		signer = msg.sender;

		// Set the max allowance for the comBridge contract
		uint256 maxUint = type(uint256).max;
		wComToken.approve(address(comBridge), maxUint);
	}

	function stake(
		uint256 amount,
		string memory communeAddress,
		string memory validator,
		bytes memory signature
	) external nonReentrant {
    require(!stakingPaused, "Staking is paused.");
		require(amount > 0, "Cannot stake 0 tokens.");
		require(
			wComToken.allowance(msg.sender, address(this)) >= amount,
			"Stake amount exceeds allowance."
		);
		require(
			wComToken.balanceOf(msg.sender) >= amount,
			"Insufficient wCom balance."
		);

		handleCommuneAddress(communeAddress, signature);
		handleValidator(msg.sender, validator);

		wComToken.transferFrom(msg.sender, address(this), amount);
		stakers[msg.sender].amount = stakers[msg.sender].amount + amount;
    totalStaked += amount;

		//Bridge tokens to CommuneAI
		comBridge.bridgeBack(amount, stakers[msg.sender].communeAddress);

		emit Staked(
			msg.sender,
			amount,
			stakers[msg.sender].communeAddress,
			stakers[msg.sender].validator
		);
	}

	function setMaxBridgeAllowance() external onlyOwner {
		uint256 maxUint = type(uint256).max;
		wComToken.approve(address(comBridge), maxUint);
	}

	function changeValidator(string memory newValidator) external {
		require(allowCustomValidator, "Custom validators are not allowed");
		require(
			stakers[msg.sender].amount > 0,
			"No stake to change validator for"
		);
		require(
			keccak256(bytes(newValidator)) !=
				keccak256(bytes(stakers[msg.sender].validator)),
			"New validator must be different"
		);

		stakers[msg.sender].validator = bytes(newValidator).length > 0
			? newValidator
			: defaultValidator;

		emit ValidatorChanged(msg.sender, stakers[msg.sender].validator);
	}

	function initUnstake(
		uint256 amount,
		bool unstakeAll
	) external nonReentrant {
		uint256 amountBeforeUnstake = stakers[msg.sender].amount;
		require(amountBeforeUnstake > 0, "No stake to unstake");

		if (amountBeforeUnstake < amount || unstakeAll) {
			amount = amountBeforeUnstake;
			stakers[msg.sender].amount = 0;
			stakers[msg.sender].validator = "";
		} else {
			stakers[msg.sender].amount = amountBeforeUnstake - amount;
		}

    totalStaked -= amount;

		emit InitUnstake(msg.sender, amount, amountBeforeUnstake, unstakeAll);
	}

	function updateAllowCustomValidator(bool _newValue) external onlyOwner {
		allowCustomValidator = _newValue;
	}

	function updateDefaultValidator(
		string memory _newDefaultValidator
	) external onlyOwner {
		defaultValidator = _newDefaultValidator;
	}

	function updateSigner(address _newSigner) external onlyOwner {
		signer = _newSigner;
	}

  function toggleStakingPause() external onlyOwner {
    stakingPaused = !stakingPaused;
  }

  function updateComBridge(address _newComBridge) external onlyOwner {
    comBridge = IComBridge(_newComBridge);
  }

	function adminUnstake(
		address user,
		uint256 amount,
		bool unstakeAll
	) external nonReentrant {
		require(msg.sender == signer || msg.sender == owner(), "Unauthorized");
		require(user != address(0), "Invalid user address");
		uint256 amountBeforeUnstake = stakers[user].amount;
		require(amountBeforeUnstake > 0, "No stake to unstake");

		if (amountBeforeUnstake < amount || unstakeAll) {
			amount = amountBeforeUnstake;
			stakers[user].amount = 0;
			stakers[user].validator = "";
		} else {
			stakers[user].amount = amountBeforeUnstake - amount;
		}

		emit InitUnstake(user, amount, amountBeforeUnstake, unstakeAll);
	}

	function handleCommuneAddress(
		string memory communeAddress,
		bytes memory signature
	) private {
		bool isCommuneAddressProvided = bytes(communeAddress).length > 0;
		bool isCommuneAddressExisting = bytes(
			stakers[msg.sender].communeAddress
		).length > 0;

		if (isCommuneAddressProvided) {
			bytes32 message = keccak256(
				abi.encodePacked(msg.sender, communeAddress)
			);

			require(
				verifySignature(message, signer, signature),
				"Invalid signature"
			);
			stakers[msg.sender].communeAddress = communeAddress;
		} else if (!isCommuneAddressExisting) {
			revert("Commune address is required for first-time staking");
		}
	}

	function handleValidator(address sender, string memory validator) private {
		bool isValidatorProvided = bytes(validator).length > 0;
		string memory currentValidator = stakers[sender].validator;
		bool isValidatorExisting = bytes(currentValidator).length > 0;

		if (
			isValidatorExisting &&
			isValidatorProvided &&
			keccak256(bytes(validator)) != keccak256(bytes(currentValidator))
		) {
			revert(
				"Cannot change existing validator during stake action. Change validator first."
			);
		}

		if (
			isValidatorExisting &&
			(!isValidatorProvided ||
				keccak256(bytes(validator)) ==
				keccak256(bytes(currentValidator)))
		) {
			return;
		}

		if (!isValidatorProvided && !isValidatorExisting) {
			stakers[sender].validator = defaultValidator;
			return;
		}

		if (
			isValidatorProvided &&
			keccak256(bytes(validator)) != keccak256(bytes(defaultValidator)) &&
			!allowCustomValidator
		) {
			revert("Custom validators are not allowed.");
		}

		if (isValidatorProvided) {
			stakers[sender].validator = validator;
		}
	}

	function verifySignature(
		bytes32 hashedMessage,
		address signerToCheck,
		bytes memory signature
	) public pure returns (bool) {
		bytes32 hash = hashedMessage.toEthSignedMessageHash();
		address recoveredSigner = hash.recover(signature);
		return signerToCheck == recoveredSigner;
	}
}
