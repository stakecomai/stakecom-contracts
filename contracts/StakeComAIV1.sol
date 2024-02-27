// SPDX-License-Identifier: MIT

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

	// Custom errors
	error StakingPaused();
	error ZeroStakeAmount();
	error StakeAmountTooLow(uint256 minDeposit);
	error CapacityLimitReached(uint256 capacityLimit);
	error InsufficientAllowance(uint256 required, uint256 current);
	error InsufficientBalance(uint256 required, uint256 current);
	error CustomValidatorNotAllowed();
	error InvalidValidatorChange();
	error NoStakeToChangeValidator();
	error NoStakeToUnstake();
	error Unauthorized();
	error InvalidUserAddress();
	error InvalidSignature();
	error CommuneAddressNotSet();
	error InvalidValidator();

	IERC20 public wCOMAIToken;
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
	uint256 public minDeposit = 15 * 10 ** 18;
	uint256 public capacityLimit = 0;

  // Events
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
		address _wCOMAIAddress,
		address _bridgeAddress,
		string memory _defaultValidator
	) Ownable(msg.sender) {
		if (_wCOMAIAddress == address(0) || _bridgeAddress == address(0))
			revert InvalidUserAddress();
		wCOMAIToken = IERC20(_wCOMAIAddress);
		comBridge = IComBridge(_bridgeAddress);
		defaultValidator = _defaultValidator;
		signer = msg.sender;
		// Set the max allowance for the comBridge contract
		uint256 maxUint = type(uint256).max;
		wCOMAIToken.approve(address(comBridge), maxUint);
	}

	function stake(
		uint256 amount,
		string memory communeAddress,
		string memory validator,
		bytes memory signature
	) external nonReentrant {
		if (stakingPaused) revert StakingPaused();
		if (amount < minDeposit) revert StakeAmountTooLow(minDeposit);
		if (capacityLimit > 0 && totalStaked + amount > capacityLimit)
			revert CapacityLimitReached(capacityLimit);
		if (amount == 0) revert ZeroStakeAmount();
		if (wCOMAIToken.allowance(msg.sender, address(this)) < amount)
			revert InsufficientAllowance(
				amount,
				wCOMAIToken.allowance(msg.sender, address(this))
			);
		if (wCOMAIToken.balanceOf(msg.sender) < amount)
			revert InsufficientBalance(
				amount,
				wCOMAIToken.balanceOf(msg.sender)
			);

		handleCommuneAddress(communeAddress, signature);
		handleValidator(msg.sender, validator);

		wCOMAIToken.transferFrom(msg.sender, address(this), amount);
		stakers[msg.sender].amount += amount;
		totalStaked += amount;

		// Bridge tokens to CommuneAI
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
		wCOMAIToken.approve(address(comBridge), maxUint);
	}

	function changeValidator(string memory newValidator) external {
		if (!allowCustomValidator) revert CustomValidatorNotAllowed();
		if (stakers[msg.sender].amount == 0) revert NoStakeToChangeValidator();
		if (
			keccak256(bytes(newValidator)) ==
			keccak256(bytes(stakers[msg.sender].validator))
		) revert InvalidValidatorChange();

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
		if (amountBeforeUnstake == 0) revert NoStakeToUnstake();

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

	function updateComBridge(address _newCOMAIBridge) external onlyOwner {
		comBridge = IComBridge(_newCOMAIBridge);
	}

	function updateMinDeposit(uint256 _newMinDeposit) external onlyOwner {
		minDeposit = _newMinDeposit;
	}

	function updateCapacityLimit(uint256 _newCapacityLimit) external onlyOwner {
		capacityLimit = _newCapacityLimit;
	}

	function adminUnstake(
		address user,
		uint256 amount,
		bool unstakeAll
	) external nonReentrant {
		if (!(msg.sender == signer || msg.sender == owner()))
			revert Unauthorized();
		if (user == address(0)) revert InvalidUserAddress();
		uint256 amountBeforeUnstake = stakers[user].amount;
		if (amountBeforeUnstake == 0) revert NoStakeToUnstake();

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
			if (!verifySignature(message, signer, signature))
				revert InvalidSignature();
			stakers[msg.sender].communeAddress = communeAddress;
		} else if (!isCommuneAddressExisting) {
			revert CommuneAddressNotSet();
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
			revert InvalidValidator();
		}

		if (!isValidatorProvided && !isValidatorExisting) {
			stakers[sender].validator = defaultValidator;
			return;
		}

		if (isValidatorProvided) {
			if (
				keccak256(bytes(validator)) !=
				keccak256(bytes(defaultValidator)) &&
				!allowCustomValidator
			) {
				revert CustomValidatorNotAllowed();
			}
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
