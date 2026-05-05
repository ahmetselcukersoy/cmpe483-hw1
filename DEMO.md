# Demo Steps

## Before starting
- Open 2 terminals in the project root.
- MetaMask: add Hardhat network (`http://127.0.0.1:8545`, chainId `31337`).

## 1. Verify Hardhat version
```bash
npx hardhat --version   # 3.4.4
```

## 2. Run tests
```bash
npm run test            # 45 passing
```

## 3. Show contracts
- `contracts/Lottery.sol` — interface functions, `_getPrizeCount`, `_calculatePrize`, `revealRndNumber` salted hash.
- `contracts/LotteryTicket.sol::_update` — direct transfer guard.

## 4. Start local node
**Terminal A:**
```bash
npm run node
```
Copy the first account's private key.

## 5. Deploy
**Terminal B:**
```bash
npm run deploy:local
```
Copy the 3 contract addresses.

## 6. Frontend
1. Open `frontend/index.html`.
2. MetaMask → import account with the private key from step 4.
3. Paste 3 addresses → **Save & Connect** → **Connect Wallet**.
4. **Mint TL**: 500.
5. **Deposit**: 500.
6. **Buy Ticket**: random `12345` (remember it).

## 7. Skip to reveal stage
**Terminal B:**
```bash
npx hardhat console --network localhost
```
```js
const { network } = await import("hardhat");
const { networkHelpers } = await network.create();
await networkHelpers.time.increase(4*24*60*60 + 1);
.exit
```
Refresh page → stage shows **Reveal**.

## 8. Reveal
- **Reveal Random Number**: Ticket `1`, Random `12345`.

## 9. End the lottery
```bash
npx hardhat console --network localhost
```
```js
const { network } = await import("hardhat");
const { networkHelpers } = await network.create();
await networkHelpers.time.increase(3*24*60*60 + 1);
.exit
```

## 10. Collect & withdraw
- **View Winners** → click **Collect** on rows marked "You!".
- **Withdraw TL**: 500 → wallet balance increases.

## Before submission
- Remove `.env` from the ZIP.
- Exclude: `node_modules/`, `artifacts/`, `cache/`, `types/ethers-contracts/`, `.env`.
