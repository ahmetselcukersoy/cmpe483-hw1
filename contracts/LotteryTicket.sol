// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LotteryTicket
 * @dev ERC721 NFT representing lottery tickets. Only the Lottery contract can mint.
 */
contract LotteryTicket is ERC721, Ownable {
    uint256 private _nextTokenId;
    address public lotteryContract;

    error OnlyLottery();
    error LotteryAlreadySet();

    modifier onlyLottery() {
        if (msg.sender != lotteryContract) revert OnlyLottery();
        _;
    }

    constructor() ERC721("Lottery Ticket", "LTKT") Ownable(msg.sender) {
        _nextTokenId = 1; // Start ticket IDs from 1
    }

    /**
     * @dev Set the lottery contract address. Can only be set once.
     * @param _lottery The address of the lottery contract
     */
    function setLotteryContract(address _lottery) external onlyOwner {
        if (lotteryContract != address(0)) revert LotteryAlreadySet();
        lotteryContract = _lottery;
    }

    /**
     * @dev Mint a new ticket. Only callable by the lottery contract.
     * @param to The address to mint the ticket to
     * @return tokenId The ID of the newly minted ticket
     */
    function mint(address to) external onlyLottery returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
    }

    /**
     * @dev Get the current token counter (next token ID to be minted)
     * @return The next token ID
     */
    function getNextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    /**
     * @dev Transfer ticket from one address to another. Called by Lottery contract.
     * @param from The current owner
     * @param to The new owner
     * @param tokenId The ticket ID to transfer
     */
    function transferTicket(address from, address to, uint256 tokenId) external onlyLottery {
        _transfer(from, to, tokenId);
    }
}
