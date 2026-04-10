// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TLToken
 * @dev ERC20 token for the lottery system. Anyone can mint tokens for testing purposes.
 */
contract TLToken is ERC20 {
    constructor() ERC20("TL Token", "TL") {}

    /**
     * @dev Public mint function for testing purposes.
     * @param amount The amount of tokens to mint (in smallest unit)
     */
    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }

    /**
     * @dev Mint tokens to a specific address.
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     */
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
