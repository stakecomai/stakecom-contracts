// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * This file was generated with Openzeppelin Wizard and later modified.
 * GO TO: https://wizard.openzeppelin.com/#erc20
 */
contract MockBridge {
	IERC20 public wCOMAIToken;

	struct BridgeUsers {
		uint256 amount;
		string toAddress;
	}

	mapping(address => BridgeUsers) public bridgeUsers;

	constructor(address wCOMAIAddress) {
		wCOMAIToken = IERC20(wCOMAIAddress);
	}

	function bridgeBack(uint256 amount, string memory to) external {
		wCOMAIToken.transferFrom(msg.sender, address(this), amount);
		bridgeUsers[msg.sender] = BridgeUsers(amount, to);
	}
}
