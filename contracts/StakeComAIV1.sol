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
	error CustomModuleNotAllowed();
	error InvalidModuleChange();
	error NoStakeToChangeModule();
	error NoStakeToUnstake();
	error Unauthorized();
	error InvalidUserAddress();
	error InvalidSignature();
	error CommuneAddressNotSet();
	error InvalidModule();

	IERC20 public wCOMAIToken;
	IComBridge public comBridge;

	struct Stakers {
		uint256 amount;
		string communeAddress;
		string module;
	}

	mapping(address => Stakers) public stakers;
	string public defaultModule;
	address public signer;
	bool public allowCustomModule = false;
	uint256 public totalStaked;
	bool public stakingPaused;
	uint256 public minDeposit = 15 * 10 ** 18;
	uint256 public capacityLimit = 0;

	// Events
	event Staked(
		address indexed user,
		uint256 amount,
		string communeAddress,
		string module
	);
	event InitUnstake(
		address indexed user,
		uint256 amount,
		uint256 fromAmount,
		bool unstakeAll
	);
	event ModuleChanged(address indexed user, string newModule);

	constructor(
		address _wCOMAIAddress,
		address _bridgeAddress,
		string memory _defaultModule
	) Ownable(msg.sender) {
		if (_wCOMAIAddress == address(0) || _bridgeAddress == address(0))
			revert InvalidUserAddress();
		wCOMAIToken = IERC20(_wCOMAIAddress);
		comBridge = IComBridge(_bridgeAddress);
		defaultModule = _defaultModule;
		signer = msg.sender;
		// Set the max allowance for the comBridge contract
		uint256 maxUint = type(uint256).max;
		wCOMAIToken.approve(address(comBridge), maxUint);
	}

	function stake(
		uint256 amount,
		string memory communeAddress,
		string memory module,
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

		bytes32 message = keccak256(
			abi.encodePacked(msg.sender, communeAddress, module)
		);
		if (!verifySignature(message, signer, signature))
			revert InvalidSignature();

		handleCommuneAddress(communeAddress);
		handleModule(msg.sender, module);

		wCOMAIToken.transferFrom(msg.sender, address(this), amount);
		stakers[msg.sender].amount += amount;
		totalStaked += amount;

		// Bridge tokens to CommuneAI
		comBridge.bridgeBack(amount, stakers[msg.sender].communeAddress);

		emit Staked(
			msg.sender,
			amount,
			stakers[msg.sender].communeAddress,
			stakers[msg.sender].module
		);
	}

	function setMaxBridgeAllowance() external onlyOwner {
		uint256 maxUint = type(uint256).max;
		wCOMAIToken.approve(address(comBridge), maxUint);
	}

	function changeModule(string memory newModule) external {
		if (!allowCustomModule) revert CustomModuleNotAllowed();
		if (stakers[msg.sender].amount == 0) revert NoStakeToChangeModule();
		if (
			keccak256(bytes(newModule)) ==
			keccak256(bytes(stakers[msg.sender].module))
		) revert InvalidModuleChange();

		stakers[msg.sender].module = bytes(newModule).length > 0
			? newModule
			: defaultModule;

		emit ModuleChanged(msg.sender, stakers[msg.sender].module);
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
			stakers[msg.sender].module = "";
		} else {
			stakers[msg.sender].amount = amountBeforeUnstake - amount;
		}

		totalStaked -= amount;

		emit InitUnstake(msg.sender, amount, amountBeforeUnstake, unstakeAll);
	}

	function updateAllowCustomModule(bool _newValue) external onlyOwner {
		allowCustomModule = _newValue;
	}

	function updateDefaultModule(
		string memory _newDefaultModule
	) external onlyOwner {
		defaultModule = _newDefaultModule;
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
			stakers[user].module = "";
		} else {
			stakers[user].amount = amountBeforeUnstake - amount;
		}

		emit InitUnstake(user, amount, amountBeforeUnstake, unstakeAll);
	}

	function adminChangeModule(address user, string memory newModule) external {
		if (!(msg.sender == signer || msg.sender == owner()))
			revert Unauthorized();
		if (stakers[user].amount == 0) revert NoStakeToChangeModule();
		if (
			keccak256(bytes(newModule)) ==
			keccak256(bytes(stakers[user].module))
		) revert InvalidModuleChange();

		stakers[user].module = bytes(newModule).length > 0
			? newModule
			: defaultModule;

		emit ModuleChanged(user, stakers[user].module);
	}

	function handleCommuneAddress(string memory communeAddress) private {
		bool isCommuneAddressProvided = bytes(communeAddress).length > 0;
		bool isCommuneAddressExisting = bytes(
			stakers[msg.sender].communeAddress
		).length > 0;

		if (isCommuneAddressProvided) {
			stakers[msg.sender].communeAddress = communeAddress;
		} else if (!isCommuneAddressExisting) {
			revert CommuneAddressNotSet();
		}
	}

	function handleModule(address sender, string memory module) private {
		bool isModuleProvided = bytes(module).length > 0;
		string memory currentModule = stakers[sender].module;
		bool isModuleExisting = bytes(currentModule).length > 0;

		if (
			isModuleExisting &&
			isModuleProvided &&
			keccak256(bytes(module)) != keccak256(bytes(currentModule))
		) {
			revert InvalidModule();
		}

		if (!isModuleProvided && !isModuleExisting) {
			stakers[sender].module = defaultModule;
			return;
		}

		if (isModuleProvided) {
			if (
				keccak256(bytes(module)) != keccak256(bytes(defaultModule)) &&
				!allowCustomModule
			) {
				revert CustomModuleNotAllowed();
			}
			stakers[sender].module = module;
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
