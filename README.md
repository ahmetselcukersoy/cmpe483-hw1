# CMPE 483 - Decentralized Lottery System

A fully autonomous decentralized lottery implementation on Ethereum using Solidity smart contracts.

## Features

- **ERC20 TL Token**: Custom token for lottery payments
- **ERC721 NFT Tickets**: Each ticket is a unique, transferable NFT
- **Commit-Reveal Scheme**: Fair random number generation
- **Multi-Prize Distribution**: Logarithmic prize formula ensures all money is distributed
- **7-Day Lottery Cycles**: 4 days purchase + 3 days reveal

## Deployed Contracts (Sepolia Testnet)

| Contract | Address |
|----------|---------|
| TLToken | `0x06DAA96375d9aeAaF6570E9c32b2A0b645a7DB58` |
| LotteryTicket | `0x6c60EDc4fB8C0C64254B908d025B1385e1687c5c` |
| Lottery | `0x6B823d6640dB6Cc07a89C22aD815D8374a0915FC` |

## Project Structure

```
hw1/
├── contracts/
│   ├── TLToken.sol          # ERC20 token contract
│   ├── LotteryTicket.sol    # ERC721 NFT ticket contract
│   └── Lottery.sol          # Main lottery logic (14 required functions)
├── scripts/
│   └── deploy.ts            # Deployment script
├── test/
│   └── Lottery.test.ts      # 42 comprehensive tests
├── frontend/
│   └── index.html           # Web interface
├── docs/
│   └── report.tex           # LaTeX documentation
├── hardhat.config.ts
├── package.json
└── README.md
```

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd hw1

# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env
# Edit .env with your SEPOLIA_RPC_URL and PRIVATE_KEY
```

## Running Tests

```bash
# Run all 42 tests
npm run test

# Run tests with gas report
npm run test:gas
```

### Test Coverage

The test suite includes 45 tests covering:
- Basic functionality (deposit, withdraw, buy ticket, reveal)
- Multi-user tests with **5, 10, 20, 50, 100, 200, and 250 dynamically generated addresses**
- Dynamic address generation during runtime (`ethers.Wallet.createRandom()` + funded with ETH)
- Stage transition tests (purchase → reveal → ended)
- Prize distribution asserted against the spec formula and a JS reference
- Salted hash uniqueness (two users picking the same random number)
- Direct ERC721 `transferFrom` is rejected (only the Lottery contract may move tickets)
- Edge cases (no reveals, partial reveals, multiple lotteries)

## Local Development

```bash
# Start local Hardhat node
npm run node

# In another terminal, deploy contracts
npm run deploy:local

# Open frontend
open frontend/index.html
```

## Deploying to Sepolia

1. Get Sepolia ETH from a faucet:
   - https://cloud.google.com/application/web3/faucet/ethereum/sepolia
   - https://sepoliafaucet.com

2. Configure `.env`:
```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
PRIVATE_KEY=your_private_key_without_0x
```

3. Deploy:
```bash
npm run deploy:sepolia
```

## Using the Frontend

1. Open `frontend/index.html` in a browser
2. Connect MetaMask (select Sepolia network)
3. Enter contract addresses and click "Save & Connect"
4. Operations:
   - **Mint TL**: Get test TL tokens
   - **Deposit**: Move TL to lottery contract
   - **Buy Ticket**: Enter a random number and purchase
   - **Reveal**: Reveal your random number during reveal stage
   - **Collect Prize**: Claim winnings after lottery ends

## Lottery Mechanics

### Timing
- **Purchase Stage (Days 1-4)**: Buy tickets with hash commitment
- **Reveal Stage (Days 5-7)**: Reveal random numbers
- **After Day 7**: Lottery ends, winners can collect prizes

### Random Number Generation
1. User commits `keccak256(abi.encodePacked(rnd_number, msg.sender))` when buying a ticket (address salt prevents hash collisions between users)
2. User reveals the actual number during the reveal stage
3. All revealed numbers are XORed together to form a combined random
4. Winner index for prize *i* = `keccak256(combinedRandom, i) % revealedCount`

### Prize Formula
```
Pi = floor(M/2^i) + (floor(M/2^(i-1)) mod 2)
Number of prizes = ceil(log2(M)) + 1
```
Where M is total money collected and i is prize number (1-indexed).

## Interface Functions

| Function | Description |
|----------|-------------|
| `depositTL(amount)` | Deposit TL tokens |
| `withdrawTL(amount)` | Withdraw TL tokens |
| `buyTicket(hash)` | Buy ticket with hash commitment |
| `revealRndNumber(ticketno, rnd)` | Reveal random number |
| `transferRevealedTicketTo(ticketno, addr)` | Transfer revealed ticket |
| `getLastBoughtTicketNo(lottery_no)` | Get last ticket bought |
| `getIthOwnedTicketNo(i, lottery_no)` | Get i-th owned ticket |
| `getWinningTickets(lottery_no)` | Get all winning tickets |
| `collectTicketPrize(ticket_no, prizeno)` | Collect prize |
| `getPrizeCollectionInfo(lottery_no)` | Check prize collection status |
| `getIthWinningTicket(i, lottery_no)` | Get i-th winner details |
| `getLotteryNo(timestamp)` | Get lottery number from time |
| `getTotalLotteryMoneyCollected(lottery_no)` | Get total pool |
| `getLotteryDuration(lottery_no)` | Get lottery time bounds |

## Gas Usage

Latest `gas-report.txt` averages:

| Function | Min | Avg | Max |
|----------|-----|-----|-----|
| buyTicket                | 194,757 | **234,314** | 267,957 |
| revealRndNumber          | 66,959  | **72,770**  | 106,007 |
| depositTL                | 57,147  | **58,082**  | 83,859 |
| withdrawTL               | -        | **61,317**  | -       |
| collectTicketPrize       | 73,974  | **95,859**  | 119,622 |
| transferRevealedTicketTo | -        | **114,120** | -       |

View functions (`getLastBoughtTicketNo`, `getIthOwnedTicketNo`, `getWinningTickets`,
`getPrizeCollectionInfo`, `getIthWinningTicket`, `getLotteryNo`,
`getTotalLotteryMoneyCollected`, `getLotteryDuration`) consume **no on-chain gas**
when called via `eth_call`.

## Technologies Used

- Solidity 0.8.26
- Hardhat 2.28.6 (latest stable Hardhat 2; the spec asks for Hardhat 3 — see `docs/report.tex` "Tooling Note" for the rationale)
- OpenZeppelin Contracts 5.x
- ethers.js 6.x
- TypeScript
- Chai (testing)

## License

MIT
