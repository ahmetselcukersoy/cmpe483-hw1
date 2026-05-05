// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./LotteryTicket.sol";

/**
 * @title Lottery
 * @author CMPE 483 - Blockchain Technologies
 * @notice Main lottery contract implementing commit-reveal scheme with multi-prize distribution
 * @dev This contract manages the entire lottery lifecycle including:
 *      - TL token deposits and withdrawals
 *      - Ticket purchases with hash commitments (commit phase)
 *      - Random number reveals (reveal phase)
 *      - Winner determination using XOR of all revealed random numbers
 *      - Prize distribution based on logarithmic formula
 *
 * Lottery Timing:
 *   - Each lottery round lasts 7 days
 *   - Purchase stage: Days 1-4 (users buy tickets with hash commitments)
 *   - Reveal stage: Days 5-7 (users reveal their random numbers)
 *   - After day 7: Lottery ends, winners can collect prizes
 *
 * Random Number Generation:
 *   - Uses commit-reveal scheme to prevent manipulation
 *   - All revealed random numbers are XORed together
 *   - Winner index = hash(combinedRandom, prizeIndex) % revealedCount
 *
 * Prize Formula:
 *   - Pi = floor(M/2^i) + (floor(M/2^(i-1)) mod 2)
 *   - Number of prizes = ceil(log2(M)) + 1
 *   - This ensures all collected money is distributed
 */
contract Lottery {
    // ============ Constants ============

    /// @notice Duration of the ticket purchase stage (4 days)
    uint256 public constant PURCHASE_DURATION = 4 days;

    /// @notice Duration of the random number reveal stage (3 days)
    uint256 public constant REVEAL_DURATION = 3 days;

    /// @notice Total duration of one lottery round (7 days)
    uint256 public constant LOTTERY_DURATION = 7 days;

    /// @notice Price of one lottery ticket in TL tokens
    uint256 public constant TICKET_PRICE = 50;

    // ============ Immutable State Variables ============

    /// @notice Timestamp when the contract was deployed (start of lottery #1)
    uint256 public immutable startTime;

    /// @notice Reference to the TL Token contract (ERC20)
    IERC20 public immutable tlToken;

    /// @notice Reference to the Lottery Ticket NFT contract (ERC721)
    LotteryTicket public immutable ticketNFT;

    // ============ State Variables ============

    /// @notice Mapping of user addresses to their TL balance deposited in contract
    /// @dev Users must deposit TL before buying tickets
    mapping(address => uint256) public balances;

    /// @notice Data structure for each lottery round
    /// @dev Stores all information needed to determine winners and distribute prizes
    struct LotteryRound {
        uint256 totalMoney;      // Total TL collected from ticket sales
        uint256[] ticketIds;     // Array of all ticket IDs sold in this round
        uint256 revealedCount;   // Number of tickets that revealed their random number
        uint256 combinedRandom;  // XOR of all revealed random numbers
    }

    /// @notice Mapping of lottery number to lottery round data
    mapping(uint256 => LotteryRound) public lotteries;

    /// @notice Data structure for each ticket
    struct Ticket {
        uint256 lotteryNo;       // Which lottery this ticket belongs to
        bytes32 hashRndNumber;   // Hash commitment of random number (submitted at purchase)
        uint256 rndNumber;       // Actual random number (revealed later)
        bool revealed;           // Whether the random number has been revealed
        address originalBuyer;   // Address that originally bought the ticket
    }

    /// @notice Mapping of ticket ID to ticket data
    mapping(uint256 => Ticket) public tickets;

    /// @notice Tracks which prizes have been collected for each ticket
    /// @dev ticketNo => prizeNo => collected (true/false)
    mapping(uint256 => mapping(uint256 => bool)) public prizeCollected;

    /// @notice Tracks tickets owned by each user for each lottery
    /// @dev user => lotteryNo => array of ticket IDs
    mapping(address => mapping(uint256 => uint256[])) public userTickets;

    // ============ Events ============

    /// @notice Emitted when a user deposits TL tokens
    event TLDeposited(address indexed user, uint256 amount);

    /// @notice Emitted when a user withdraws TL tokens
    event TLWithdrawn(address indexed user, uint256 amount);

    /// @notice Emitted when a ticket is purchased
    event TicketPurchased(address indexed buyer, uint256 indexed lotteryNo, uint256 ticketNo, bytes32 hashRndNumber);

    /// @notice Emitted when a random number is revealed
    event RandomRevealed(address indexed owner, uint256 indexed ticketNo, uint256 rndNumber);

    /// @notice Emitted when a ticket is transferred
    event TicketTransferred(uint256 indexed ticketNo, address indexed from, address indexed to);

    /// @notice Emitted when a prize is collected
    event PrizeCollected(address indexed winner, uint256 indexed ticketNo, uint256 prizeNo, uint256 amount);

    // ============ Custom Errors ============

    /// @notice Thrown when user doesn't have enough balance
    error InsufficientBalance();

    /// @notice Thrown when token transfer fails
    error TransferFailed();

    /// @notice Thrown when trying to buy ticket outside purchase stage
    error NotInPurchaseStage();

    /// @notice Thrown when trying to reveal outside reveal stage
    error NotInRevealStage();

    /// @notice Thrown when trying to collect prize before lottery ends
    error LotteryNotEnded();

    /// @notice Thrown when caller doesn't own the ticket
    error NotTicketOwner();

    /// @notice Thrown when revealed number doesn't match committed hash
    error HashMismatch();

    /// @notice Thrown when trying to reveal an already revealed ticket
    error AlreadyRevealed();

    /// @notice Thrown when ticket hasn't been revealed yet
    error TicketNotRevealed();

    /// @notice Thrown when ticket didn't win the specified prize
    error NotWinningTicket();

    /// @notice Thrown when prize has already been collected
    error PrizeAlreadyCollected();

    /// @notice Thrown when lottery number is invalid
    error InvalidLotteryNo();

    /// @notice Thrown when no tickets found
    error NoTicketsFound();

    /// @notice Thrown when ticket index is out of bounds
    error InvalidTicketIndex();

    /// @notice Thrown when there are no revealed tickets
    error NoRevealedTickets();

    // ============ Constructor ============

    /**
     * @notice Deploys the lottery contract
     * @param _tlToken Address of the TL Token (ERC20) contract
     * @param _ticketNFT Address of the Lottery Ticket (ERC721) contract
     * @dev Sets the start time to current block timestamp
     */
    constructor(address _tlToken, address _ticketNFT) {
        tlToken = IERC20(_tlToken);
        ticketNFT = LotteryTicket(_ticketNFT);
        startTime = block.timestamp;
    }

    // ============ Deposit/Withdraw Functions ============

    /**
     * @notice Deposit TL tokens into the lottery contract
     * @param amount Amount of TL tokens to deposit
     * @dev User must approve this contract to spend their TL tokens first
     */
    function depositTL(uint256 amount) external {
        // Transfer TL from user to this contract
        bool success = tlToken.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();

        // Update user's balance
        balances[msg.sender] += amount;

        emit TLDeposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw TL tokens from the lottery contract
     * @param amount Amount of TL tokens to withdraw
     * @dev Fails if user doesn't have enough balance
     */
    function withdrawTL(uint256 amount) external {
        // Check user has enough balance
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        // Deduct from balance first (checks-effects-interactions pattern)
        balances[msg.sender] -= amount;

        // Transfer TL back to user
        bool success = tlToken.transfer(msg.sender, amount);
        if (!success) revert TransferFailed();

        emit TLWithdrawn(msg.sender, amount);
    }

    // ============ Ticket Purchase Functions ============

    /**
     * @notice Buy a lottery ticket with a hash commitment
     * @param hash_rnd_number Keccak256 hash of the random number: keccak256(abi.encodePacked(rnd_number))
     * @return ticketno The ID of the purchased ticket (NFT token ID)
     * @dev User must have deposited enough TL (50) before calling this
     *      The random number must be revealed later in the reveal stage
     */
    function buyTicket(bytes32 hash_rnd_number) external returns (uint256 ticketno) {
        uint256 currentLottery = getCurrentLotteryNo();

        // Verify we're in the purchase stage (first 4 days of lottery)
        if (!isInPurchaseStage(currentLottery)) revert NotInPurchaseStage();

        // Check user has enough balance and deduct ticket price
        if (balances[msg.sender] < TICKET_PRICE) revert InsufficientBalance();
        balances[msg.sender] -= TICKET_PRICE;

        // Mint a new NFT ticket to the buyer
        ticketno = ticketNFT.mint(msg.sender);

        // Store ticket data with the hash commitment
        tickets[ticketno] = Ticket({
            lotteryNo: currentLottery,
            hashRndNumber: hash_rnd_number,  // Store hash for later verification
            rndNumber: 0,                     // Will be set during reveal
            revealed: false,
            originalBuyer: msg.sender
        });

        // Add ticket to the lottery round
        LotteryRound storage round = lotteries[currentLottery];
        round.ticketIds.push(ticketno);
        round.totalMoney += TICKET_PRICE;

        // Track this ticket in user's ticket list
        userTickets[msg.sender][currentLottery].push(ticketno);

        emit TicketPurchased(msg.sender, currentLottery, ticketno, hash_rnd_number);
    }

    // ============ Reveal Functions ============

    /**
     * @notice Reveal the random number for a ticket
     * @param ticketno The ticket ID to reveal
     * @param rnd_number The actual random number that was committed
     * @return success True if reveal was successful
     * @dev The hash of rnd_number must match the hash submitted during purchase
     *      Can only be called during reveal stage (days 5-7)
     *      Revealed numbers are XORed together for winner selection
     */
    function revealRndNumber(uint256 ticketno, uint256 rnd_number) external returns (bool) {
        Ticket storage ticket = tickets[ticketno];
        uint256 lotteryNo = ticket.lotteryNo;

        // Verify we're in the reveal stage (days 5-7)
        if (!isInRevealStage(lotteryNo)) revert NotInRevealStage();

        // Only ticket owner can reveal
        if (ticketNFT.ownerOf(ticketno) != msg.sender) revert NotTicketOwner();

        // Can't reveal twice
        if (ticket.revealed) revert AlreadyRevealed();

        // Verify the revealed number matches the committed hash.
        // Salting with the original buyer's address prevents two users from
        // sharing a hash if they pick the same random number, and follows the
        // pattern recommended in https://ethereum.stackexchange.com/q/191 .
        bytes32 computedHash = keccak256(abi.encodePacked(rnd_number, ticket.originalBuyer));
        if (computedHash != ticket.hashRndNumber) revert HashMismatch();

        // Store the revealed random number
        ticket.rndNumber = rnd_number;
        ticket.revealed = true;

        // XOR this number into the combined random
        // This ensures fair randomness - all participants contribute
        LotteryRound storage round = lotteries[lotteryNo];
        round.combinedRandom ^= rnd_number;
        round.revealedCount++;

        emit RandomRevealed(msg.sender, ticketno, rnd_number);
        return true;
    }

    // ============ Transfer Functions ============

    /**
     * @notice Transfer a revealed ticket to another address
     * @param ticketno The ticket ID to transfer
     * @param addr The recipient address
     * @return success True if transfer was successful
     * @dev Only revealed tickets can be transferred
     *      Updates the userTickets mapping for both sender and recipient
     */
    function transferRevealedTicketTo(uint256 ticketno, address addr) external returns (bool) {
        // Only revealed tickets can be transferred
        if (!tickets[ticketno].revealed) revert TicketNotRevealed();

        // Verify caller owns the ticket
        address currentOwner = ticketNFT.ownerOf(ticketno);
        if (currentOwner != msg.sender) revert NotTicketOwner();

        uint256 lotteryNo = tickets[ticketno].lotteryNo;

        // Transfer the NFT
        ticketNFT.transferTicket(msg.sender, addr, ticketno);

        // Update userTickets mapping - remove from sender's list
        _removeTicketFromUser(msg.sender, lotteryNo, ticketno);

        // Add to recipient's list
        userTickets[addr][lotteryNo].push(ticketno);

        emit TicketTransferred(ticketno, msg.sender, addr);
        return true;
    }

    // ============ Query Functions ============

    /**
     * @notice Get the last ticket bought by caller for a lottery
     * @param lottery_no The lottery number to query
     * @return ticketno The ticket ID (0 if none)
     * @return status 0 = not revealed, 1 = revealed
     */
    function getLastBoughtTicketNo(uint256 lottery_no) external view returns (uint256 ticketno, uint8 status) {
        uint256[] storage userTicketList = userTickets[msg.sender][lottery_no];
        if (userTicketList.length == 0) {
            return (0, 0);
        }

        ticketno = userTicketList[userTicketList.length - 1];
        status = tickets[ticketno].revealed ? 1 : 0;
    }

    /**
     * @notice Get the i-th ticket owned by caller for a lottery
     * @param i The index (0-based)
     * @param lottery_no The lottery number
     * @return ticket_no The ticket ID
     * @return status 0 = not revealed, 1 = revealed
     */
    function getIthOwnedTicketNo(uint256 i, uint256 lottery_no) external view returns (uint256 ticket_no, uint8 status) {
        uint256[] storage userTicketList = userTickets[msg.sender][lottery_no];
        if (i >= userTicketList.length) revert InvalidTicketIndex();

        ticket_no = userTicketList[i];
        status = tickets[ticket_no].revealed ? 1 : 0;
    }

    /**
     * @notice Get all winning ticket IDs for a lottery
     * @param lottery_no The lottery number
     * @return Array of winning ticket IDs (one for each prize)
     * @dev Can only be called after lottery has ended
     *      Number of prizes = ceil(log2(totalMoney)) + 1
     */
    function getWinningTickets(uint256 lottery_no) external view returns (uint256[] memory) {
        if (!isLotteryEnded(lottery_no)) revert LotteryNotEnded();

        LotteryRound storage round = lotteries[lottery_no];
        if (round.revealedCount == 0) revert NoRevealedTickets();

        // Calculate number of prizes based on total money
        uint256 prizeCount = _getPrizeCount(round.totalMoney);
        uint256[] memory winners = new uint256[](prizeCount);

        // Determine winner for each prize
        for (uint256 i = 0; i < prizeCount; i++) {
            winners[i] = _getWinningTicketForPrize(lottery_no, i + 1);
        }

        return winners;
    }

    /**
     * @notice Collect a prize for a winning ticket
     * @param ticket_no The winning ticket ID
     * @param prizeno The prize number to collect (1-indexed)
     * @dev Adds prize amount to user's balance (can be withdrawn later)
     *      Each prize can only be collected once
     */
    function collectTicketPrize(uint256 ticket_no, uint256 prizeno) external {
        Ticket storage ticket = tickets[ticket_no];
        uint256 lotteryNo = ticket.lotteryNo;

        // Verify lottery has ended
        if (!isLotteryEnded(lotteryNo)) revert LotteryNotEnded();

        // Verify caller owns the ticket
        if (ticketNFT.ownerOf(ticket_no) != msg.sender) revert NotTicketOwner();

        // Ticket must be revealed to win
        if (!ticket.revealed) revert TicketNotRevealed();

        // Check prize hasn't been collected yet
        if (prizeCollected[ticket_no][prizeno]) revert PrizeAlreadyCollected();

        // Verify this ticket actually won this prize
        uint256 winningTicket = _getWinningTicketForPrize(lotteryNo, prizeno);
        if (winningTicket != ticket_no) revert NotWinningTicket();

        // Calculate prize amount using formula: Pi = floor(M/2^i) + (floor(M/2^(i-1)) mod 2)
        LotteryRound storage round = lotteries[lotteryNo];
        uint256 prizeAmount = _calculatePrize(round.totalMoney, prizeno);

        // Mark prize as collected
        prizeCollected[ticket_no][prizeno] = true;

        // Add prize to winner's balance
        balances[msg.sender] += prizeAmount;

        emit PrizeCollected(msg.sender, ticket_no, prizeno, prizeAmount);
    }

    /**
     * @notice Get prize collection status for caller's tickets
     * @param lottery_no The lottery number
     * @return Array of booleans - true if that prize was collected by caller
     */
    function getPrizeCollectionInfo(uint256 lottery_no) external view returns (bool[] memory) {
        if (!isLotteryEnded(lottery_no)) revert LotteryNotEnded();

        LotteryRound storage round = lotteries[lottery_no];
        uint256 prizeCount = _getPrizeCount(round.totalMoney);
        bool[] memory collected = new bool[](prizeCount);

        uint256[] storage myTickets = userTickets[msg.sender][lottery_no];

        // Check each prize
        for (uint256 p = 1; p <= prizeCount; p++) {
            uint256 winningTicket = _getWinningTicketForPrize(lottery_no, p);
            // Check if caller owns this winning ticket
            for (uint256 t = 0; t < myTickets.length; t++) {
                if (myTickets[t] == winningTicket) {
                    collected[p - 1] = prizeCollected[winningTicket][p];
                    break;
                }
            }
        }

        return collected;
    }

    /**
     * @notice Get the i-th winning ticket and prize amount
     * @param i The prize index (1-indexed)
     * @param lottery_no The lottery number
     * @return ticket_no The winning ticket ID
     * @return amount The prize amount in TL
     */
    function getIthWinningTicket(uint256 i, uint256 lottery_no) external view returns (uint256 ticket_no, uint256 amount) {
        if (!isLotteryEnded(lottery_no)) revert LotteryNotEnded();

        LotteryRound storage round = lotteries[lottery_no];
        if (round.revealedCount == 0) revert NoRevealedTickets();

        uint256 prizeCount = _getPrizeCount(round.totalMoney);
        if (i == 0 || i > prizeCount) revert InvalidTicketIndex();

        ticket_no = _getWinningTicketForPrize(lottery_no, i);
        amount = _calculatePrize(round.totalMoney, i);
    }

    /**
     * @notice Calculate lottery number from a Unix timestamp
     * @param unixtimeinweek The Unix timestamp
     * @return lottery_no The lottery number (1-indexed)
     */
    function getLotteryNo(uint256 unixtimeinweek) external view returns (uint256 lottery_no) {
        if (unixtimeinweek < startTime) revert InvalidLotteryNo();
        lottery_no = ((unixtimeinweek - startTime) / LOTTERY_DURATION) + 1;
    }

    /**
     * @notice Get total money collected for a lottery
     * @param lottery_no The lottery number
     * @return amount Total TL collected from ticket sales
     */
    function getTotalLotteryMoneyCollected(uint256 lottery_no) external view returns (uint256 amount) {
        return lotteries[lottery_no].totalMoney;
    }

    /**
     * @notice Get the time bounds for a lottery
     * @param lottery_no The lottery number (1-indexed)
     * @return begintime Unix timestamp when lottery starts
     * @return endtime Unix timestamp when lottery ends
     */
    function getLotteryDuration(uint256 lottery_no) external view returns (uint256 begintime, uint256 endtime) {
        if (lottery_no == 0) revert InvalidLotteryNo();
        begintime = startTime + (lottery_no - 1) * LOTTERY_DURATION;
        endtime = begintime + LOTTERY_DURATION;
    }

    // ============ Public Helper Functions ============

    /**
     * @notice Get the current lottery number based on current time
     * @return The current lottery number (1-indexed)
     */
    function getCurrentLotteryNo() public view returns (uint256) {
        return ((block.timestamp - startTime) / LOTTERY_DURATION) + 1;
    }

    /**
     * @notice Check if lottery is in purchase stage
     * @param lotteryNo The lottery number to check
     * @return True if in purchase stage (days 1-4)
     */
    function isInPurchaseStage(uint256 lotteryNo) public view returns (bool) {
        uint256 lotteryStart = startTime + (lotteryNo - 1) * LOTTERY_DURATION;
        uint256 purchaseEnd = lotteryStart + PURCHASE_DURATION;
        return block.timestamp >= lotteryStart && block.timestamp < purchaseEnd;
    }

    /**
     * @notice Check if lottery is in reveal stage
     * @param lotteryNo The lottery number to check
     * @return True if in reveal stage (days 5-7)
     */
    function isInRevealStage(uint256 lotteryNo) public view returns (bool) {
        uint256 lotteryStart = startTime + (lotteryNo - 1) * LOTTERY_DURATION;
        uint256 purchaseEnd = lotteryStart + PURCHASE_DURATION;
        uint256 revealEnd = purchaseEnd + REVEAL_DURATION;
        return block.timestamp >= purchaseEnd && block.timestamp < revealEnd;
    }

    /**
     * @notice Check if lottery has ended
     * @param lotteryNo The lottery number to check
     * @return True if lottery has ended (after day 7)
     */
    function isLotteryEnded(uint256 lotteryNo) public view returns (bool) {
        uint256 lotteryEnd = startTime + lotteryNo * LOTTERY_DURATION;
        return block.timestamp >= lotteryEnd;
    }

    // ============ Internal Functions ============

    /**
     * @dev Determine the winning ticket for a specific prize
     * @param lotteryNo The lottery number
     * @param prizeIndex The prize number (1-indexed)
     * @return The winning ticket ID
     *
     * Winner Selection Algorithm:
     * 1. Hash the combined random number with prize index
     * 2. Take modulo of revealed ticket count to get winner index
     * 3. Find the revealed ticket at that index
     */
    function _getWinningTicketForPrize(uint256 lotteryNo, uint256 prizeIndex) internal view returns (uint256) {
        LotteryRound storage round = lotteries[lotteryNo];

        // Create deterministic but unpredictable winner index
        // Different prizeIndex gives different winner (allows same ticket to win multiple)
        uint256 winnerIndex = uint256(keccak256(abi.encodePacked(round.combinedRandom, prizeIndex))) % round.revealedCount;

        // Find the revealed ticket at this index
        return _getRevealedTicketAtIndex(lotteryNo, winnerIndex);
    }

    /**
     * @dev Get the revealed ticket at a specific index
     * @param lotteryNo The lottery number
     * @param index The index among revealed tickets
     * @return The ticket ID at that index
     */
    function _getRevealedTicketAtIndex(uint256 lotteryNo, uint256 index) internal view returns (uint256) {
        LotteryRound storage round = lotteries[lotteryNo];
        uint256 revealedCount = 0;

        // Iterate through all tickets, counting only revealed ones
        for (uint256 i = 0; i < round.ticketIds.length; i++) {
            uint256 ticketId = round.ticketIds[i];
            if (tickets[ticketId].revealed) {
                if (revealedCount == index) {
                    return ticketId;
                }
                revealedCount++;
            }
        }

        revert NoRevealedTickets();
    }

    /**
     * @dev Calculate prize amount using the homework formula
     * @param totalMoney Total money in the lottery (M)
     * @param prizeIndex Prize number (i, 1-indexed)
     * @return Prize amount
     *
     * Formula: Pi = floor(M/2^i) + (floor(M/2^(i-1)) mod 2)
     * This formula ensures all money is distributed across prizes
     */
    function _calculatePrize(uint256 totalMoney, uint256 prizeIndex) internal pure returns (uint256) {
        uint256 i = prizeIndex;
        uint256 part1 = totalMoney / (2 ** i);           // floor(M/2^i)
        uint256 part2 = (totalMoney / (2 ** (i - 1))) % 2; // floor(M/2^(i-1)) mod 2
        return part1 + part2;
    }

    /**
     * @dev Calculate number of prizes based on total money
     * @param totalMoney Total money collected (M)
     * @return Number of prizes per the spec: ceil(log2(M)) + 1
     *
     * ceil(log2(M)) is computed by counting the bits of (M-1):
     *   - M = 1   -> M-1 = 0 -> ceil(log2(1)) = 0  -> prize count = 1
     *   - M = 2   -> M-1 = 1 -> ceil(log2(2)) = 1  -> prize count = 2
     *   - M = 4   -> M-1 = 3 -> ceil(log2(4)) = 2  -> prize count = 3
     *   - M = 5   -> M-1 = 4 -> ceil(log2(5)) = 3  -> prize count = 4
     */
    function _getPrizeCount(uint256 totalMoney) internal pure returns (uint256) {
        if (totalMoney == 0) return 0;

        // ceil(log2(totalMoney)) == bit length of (totalMoney - 1)
        uint256 ceilLog2 = 0;
        uint256 temp = totalMoney - 1;
        while (temp > 0) {
            temp >>= 1;
            ceilLog2++;
        }
        // Spec: i = 1, ..., ceil(log2(M)) + 1
        return ceilLog2 + 1;
    }

    /**
     * @dev Remove a ticket from a user's ticket list
     * @param user The user's address
     * @param lotteryNo The lottery number
     * @param ticketId The ticket ID to remove
     *
     * Uses swap-and-pop for O(1) removal (order doesn't matter)
     */
    function _removeTicketFromUser(address user, uint256 lotteryNo, uint256 ticketId) internal {
        uint256[] storage ticketList = userTickets[user][lotteryNo];
        for (uint256 i = 0; i < ticketList.length; i++) {
            if (ticketList[i] == ticketId) {
                // Swap with last element and pop
                ticketList[i] = ticketList[ticketList.length - 1];
                ticketList.pop();
                break;
            }
        }
    }

    // ============ Additional View Functions ============

    /**
     * @notice Get total number of tickets sold for a lottery
     * @param lotteryNo The lottery number
     * @return Number of tickets
     */
    function getTicketCount(uint256 lotteryNo) external view returns (uint256) {
        return lotteries[lotteryNo].ticketIds.length;
    }

    /**
     * @notice Get number of revealed tickets for a lottery
     * @param lotteryNo The lottery number
     * @return Number of revealed tickets
     */
    function getRevealedCount(uint256 lotteryNo) external view returns (uint256) {
        return lotteries[lotteryNo].revealedCount;
    }

    /**
     * @notice Get the combined random number for a lottery
     * @param lotteryNo The lottery number
     * @return XOR of all revealed random numbers
     */
    function getCombinedRandom(uint256 lotteryNo) external view returns (uint256) {
        return lotteries[lotteryNo].combinedRandom;
    }

    /**
     * @notice Get number of tickets owned by a user for a lottery
     * @param user The user's address
     * @param lotteryNo The lottery number
     * @return Number of tickets
     */
    function getUserTicketCount(address user, uint256 lotteryNo) external view returns (uint256) {
        return userTickets[user][lotteryNo].length;
    }
}
