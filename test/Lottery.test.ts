import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { TLToken, LotteryTicket, Lottery } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Lottery System", function () {
  // Constants matching the contract
  const PURCHASE_DURATION = 4 * 24 * 60 * 60; // 4 days in seconds
  const REVEAL_DURATION = 3 * 24 * 60 * 60; // 3 days in seconds
  const LOTTERY_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
  const TICKET_PRICE = 50n;

  async function deployLotteryFixture() {
    const [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy TLToken
    const TLToken = await ethers.getContractFactory("TLToken");
    const tlToken = await TLToken.deploy();
    await tlToken.waitForDeployment();

    // Deploy LotteryTicket
    const LotteryTicket = await ethers.getContractFactory("LotteryTicket");
    const lotteryTicket = await LotteryTicket.deploy();
    await lotteryTicket.waitForDeployment();

    // Deploy Lottery
    const Lottery = await ethers.getContractFactory("Lottery");
    const lottery = await Lottery.deploy(
      await tlToken.getAddress(),
      await lotteryTicket.getAddress()
    );
    await lottery.waitForDeployment();

    // Set Lottery as minter for LotteryTicket
    await lotteryTicket.setLotteryContract(await lottery.getAddress());

    return { tlToken, lotteryTicket, lottery, owner, user1, user2, user3 };
  }

  // Helper to generate a random number and its salted commitment hash.
  // The contract verifies keccak256(abi.encodePacked(rnd_number, originalBuyer))
  // so the buyer's address must be mixed in here as well.
  function generateRandom(buyer: string): { rndNumber: bigint; hash: string } {
    const rndNumber = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address"],
      [rndNumber, buyer]
    );
    return { rndNumber, hash };
  }

  // Dynamically create funded random wallets so tests do not rely on
  // Hardhat's default signer set.
  async function generateUsers(
    count: number,
    funder: HardhatEthersSigner
  ): Promise<HardhatEthersSigner[]> {
    const users: HardhatEthersSigner[] = [];
    for (let i = 0; i < count; i++) {
      const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
      await funder.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther("1"),
      });
      users.push(wallet as unknown as HardhatEthersSigner);
    }
    return users;
  }

  // Setup helper for dynamically-generated users (mintTo + approve + deposit).
  async function setupDynamicUser(
    tlToken: TLToken,
    lottery: Lottery,
    user: HardhatEthersSigner,
    amount: bigint
  ) {
    await tlToken.mintTo(user.address, amount);
    await tlToken.connect(user).approve(await lottery.getAddress(), amount);
    await lottery.connect(user).depositTL(amount);
  }

  // Helper to setup user with TL tokens and deposit
  async function setupUser(
    tlToken: TLToken,
    lottery: Lottery,
    user: HardhatEthersSigner,
    amount: bigint
  ) {
    await tlToken.connect(user).mint(amount);
    await tlToken.connect(user).approve(await lottery.getAddress(), amount);
    await lottery.connect(user).depositTL(amount);
  }

  describe("Deployment", function () {
    it("Should deploy all contracts correctly", async function () {
      const { tlToken, lotteryTicket, lottery } = await loadFixture(deployLotteryFixture);

      expect(await tlToken.name()).to.equal("TL Token");
      expect(await tlToken.symbol()).to.equal("TL");
      expect(await lotteryTicket.name()).to.equal("Lottery Ticket");
      expect(await lotteryTicket.symbol()).to.equal("LTKT");
      expect(await lottery.TICKET_PRICE()).to.equal(TICKET_PRICE);
    });

    it("Should set lottery as minter for LotteryTicket", async function () {
      const { lotteryTicket, lottery } = await loadFixture(deployLotteryFixture);
      expect(await lotteryTicket.lotteryContract()).to.equal(await lottery.getAddress());
    });
  });

  describe("TLToken", function () {
    it("Should mint tokens correctly", async function () {
      const { tlToken, user1 } = await loadFixture(deployLotteryFixture);
      await tlToken.connect(user1).mint(1000n);
      expect(await tlToken.balanceOf(user1.address)).to.equal(1000n);
    });
  });

  describe("Deposit/Withdraw", function () {
    it("Should deposit TL correctly", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await tlToken.connect(user1).mint(1000n);
      await tlToken.connect(user1).approve(await lottery.getAddress(), 1000n);
      await lottery.connect(user1).depositTL(500n);

      expect(await lottery.balances(user1.address)).to.equal(500n);
      expect(await tlToken.balanceOf(user1.address)).to.equal(500n);
    });

    it("Should withdraw TL correctly", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 1000n);
      await lottery.connect(user1).withdrawTL(500n);

      expect(await lottery.balances(user1.address)).to.equal(500n);
      expect(await tlToken.balanceOf(user1.address)).to.equal(500n);
    });

    it("Should revert on insufficient balance for withdrawal", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      await expect(lottery.connect(user1).withdrawTL(200n)).to.be.revertedWithCustomError(
        lottery,
        "InsufficientBalance"
      );
    });
  });

  describe("Buy Ticket", function () {
    it("Should buy ticket in purchase stage", async function () {
      const { tlToken, lottery, lotteryTicket, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom(user1.address);

      const tx = await lottery.connect(user1).buyTicket(hash);
      await tx.wait();

      expect(await lottery.balances(user1.address)).to.equal(50n);
      expect(await lotteryTicket.ownerOf(1)).to.equal(user1.address);
    });

    it("Should store ticket data correctly", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);
      const ticket = await lottery.tickets(1);

      expect(ticket.lotteryNo).to.equal(1n);
      expect(ticket.hashRndNumber).to.equal(hash);
      expect(ticket.revealed).to.equal(false);
      expect(ticket.originalBuyer).to.equal(user1.address);
    });

    it("Should fail to buy ticket after purchase stage", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom(user1.address);

      // Move past purchase stage
      await time.increase(PURCHASE_DURATION + 1);

      await expect(lottery.connect(user1).buyTicket(hash)).to.be.revertedWithCustomError(
        lottery,
        "NotInPurchaseStage"
      );
    });

    it("Should fail to buy with insufficient balance", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 40n);
      const { hash } = generateRandom(user1.address);

      await expect(lottery.connect(user1).buyTicket(hash)).to.be.revertedWithCustomError(
        lottery,
        "InsufficientBalance"
      );
    });
  });

  describe("Reveal Random Number", function () {
    it("Should reveal random number correctly", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);

      // Move to reveal stage
      await time.increase(PURCHASE_DURATION + 1);

      await lottery.connect(user1).revealRndNumber(1, rndNumber);

      const ticket = await lottery.tickets(1);
      expect(ticket.revealed).to.equal(true);
      expect(ticket.rndNumber).to.equal(rndNumber);
    });

    it("Should fail reveal with wrong hash", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom(user1.address);
      const wrongNumber = 12345n;

      await lottery.connect(user1).buyTicket(hash);
      await time.increase(PURCHASE_DURATION + 1);

      await expect(lottery.connect(user1).revealRndNumber(1, wrongNumber)).to.be.revertedWithCustomError(
        lottery,
        "HashMismatch"
      );
    });

    it("Should fail reveal before reveal stage", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);

      await expect(lottery.connect(user1).revealRndNumber(1, rndNumber)).to.be.revertedWithCustomError(
        lottery,
        "NotInRevealStage"
      );
    });

    it("Should fail reveal after reveal stage", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);
      await time.increase(PURCHASE_DURATION + REVEAL_DURATION + 1);

      await expect(lottery.connect(user1).revealRndNumber(1, rndNumber)).to.be.revertedWithCustomError(
        lottery,
        "NotInRevealStage"
      );
    });

    it("Should fail double reveal", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);
      await time.increase(PURCHASE_DURATION + 1);
      await lottery.connect(user1).revealRndNumber(1, rndNumber);

      await expect(lottery.connect(user1).revealRndNumber(1, rndNumber)).to.be.revertedWithCustomError(
        lottery,
        "AlreadyRevealed"
      );
    });

    it("Should XOR random numbers into combined random", async function () {
      const { tlToken, lottery, user1, user2 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      await setupUser(tlToken, lottery, user2, 100n);

      const rnd1 = generateRandom(user1.address);
      const rnd2 = generateRandom(user2.address);

      await lottery.connect(user1).buyTicket(rnd1.hash);
      await lottery.connect(user2).buyTicket(rnd2.hash);

      await time.increase(PURCHASE_DURATION + 1);

      await lottery.connect(user1).revealRndNumber(1, rnd1.rndNumber);
      await lottery.connect(user2).revealRndNumber(2, rnd2.rndNumber);

      const combined = await lottery.getCombinedRandom(1);
      expect(combined).to.equal(rnd1.rndNumber ^ rnd2.rndNumber);
    });

    it("Should derive distinct hashes when two users pick the same random number", async function () {
      // This test guards the address-salt fix: identical rnd_number values
      // committed by different buyers must produce different hashes.
      const { tlToken, lottery, user1, user2 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      await setupUser(tlToken, lottery, user2, 100n);

      const sharedRnd = 424242n;
      const hash1 = ethers.solidityPackedKeccak256(
        ["uint256", "address"],
        [sharedRnd, user1.address]
      );
      const hash2 = ethers.solidityPackedKeccak256(
        ["uint256", "address"],
        [sharedRnd, user2.address]
      );
      expect(hash1).to.not.equal(hash2);

      await lottery.connect(user1).buyTicket(hash1);
      await lottery.connect(user2).buyTicket(hash2);

      await time.increase(PURCHASE_DURATION + 1);

      // user1's reveal must succeed against their own salted hash...
      await lottery.connect(user1).revealRndNumber(1, sharedRnd);
      // ...and user2's reveal of the same rnd must also succeed against their salted hash.
      await lottery.connect(user2).revealRndNumber(2, sharedRnd);

      expect(await lottery.getRevealedCount(1)).to.equal(2n);
    });
  });

  describe("Transfer Revealed Ticket", function () {
    it("Should transfer revealed ticket", async function () {
      const { tlToken, lottery, lotteryTicket, user1, user2 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);
      await time.increase(PURCHASE_DURATION + 1);
      await lottery.connect(user1).revealRndNumber(1, rndNumber);

      await lottery.connect(user1).transferRevealedTicketTo(1, user2.address);

      expect(await lotteryTicket.ownerOf(1)).to.equal(user2.address);
    });

    it("Should fail to transfer unrevealed ticket", async function () {
      const { tlToken, lottery, user1, user2 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);

      await expect(
        lottery.connect(user1).transferRevealedTicketTo(1, user2.address)
      ).to.be.revertedWithCustomError(lottery, "TicketNotRevealed");
    });

    it("Should block direct ERC721 transferFrom (only the Lottery may move tickets)", async function () {
      // Without the LotteryTicket._update guard a holder could call transferFrom
      // on the NFT directly, bypassing transferRevealedTicketTo and the
      // "must be revealed" rule. Verify the guard reverts such attempts.
      const { tlToken, lottery, lotteryTicket, user1, user2 } =
        await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom(user1.address);
      await lottery.connect(user1).buyTicket(hash);

      await expect(
        lotteryTicket.connect(user1).transferFrom(user1.address, user2.address, 1)
      ).to.be.revertedWithCustomError(lotteryTicket, "OnlyLottery");
    });
  });

  describe("Query Functions", function () {
    it("Should get last bought ticket", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 200n);
      const rnd1 = generateRandom(user1.address);
      const rnd2 = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(rnd1.hash);
      await lottery.connect(user1).buyTicket(rnd2.hash);

      const [ticketNo, status] = await lottery.connect(user1).getLastBoughtTicketNo(1);
      expect(ticketNo).to.equal(2n);
      expect(status).to.equal(0);
    });

    it("Should get i-th owned ticket", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 200n);
      const rnd1 = generateRandom(user1.address);
      const rnd2 = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(rnd1.hash);
      await lottery.connect(user1).buyTicket(rnd2.hash);

      const [ticket0] = await lottery.connect(user1).getIthOwnedTicketNo(0, 1);
      const [ticket1] = await lottery.connect(user1).getIthOwnedTicketNo(1, 1);

      expect(ticket0).to.equal(1n);
      expect(ticket1).to.equal(2n);
    });

    it("Should get lottery number from timestamp", async function () {
      const { lottery } = await loadFixture(deployLotteryFixture);

      const startTime = await lottery.startTime();
      const lotteryNo = await lottery.getLotteryNo(startTime);
      expect(lotteryNo).to.equal(1n);

      const lotteryNo2 = await lottery.getLotteryNo(startTime + BigInt(LOTTERY_DURATION));
      expect(lotteryNo2).to.equal(2n);
    });

    it("Should get lottery duration", async function () {
      const { lottery } = await loadFixture(deployLotteryFixture);

      const startTime = await lottery.startTime();
      const [begin, end] = await lottery.getLotteryDuration(1);

      expect(begin).to.equal(startTime);
      expect(end).to.equal(startTime + BigInt(LOTTERY_DURATION));
    });

    it("Should get total money collected", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 200n);
      await lottery.connect(user1).buyTicket(generateRandom(user1.address).hash);
      await lottery.connect(user1).buyTicket(generateRandom(user1.address).hash);

      const total = await lottery.getTotalLotteryMoneyCollected(1);
      expect(total).to.equal(100n);
    });
  });

  describe("Prize Calculation", function () {
    // JS reference implementation of the spec formula. Used to assert the
    // contract returns the same per-prize amounts.
    function expectedPrize(M: bigint, i: bigint): bigint {
      const part1 = M / (1n << i);             // floor(M / 2^i)
      const part2 = (M / (1n << (i - 1n))) % 2n; // floor(M / 2^(i-1)) mod 2
      return part1 + part2;
    }

    function expectedPrizeCount(M: bigint): bigint {
      // ceil(log2(M)) + 1
      if (M === 0n) return 0n;
      let ceilLog2 = 0n;
      let temp = M - 1n;
      while (temp > 0n) {
        temp >>= 1n;
        ceilLog2++;
      }
      return ceilLog2 + 1n;
    }

    it("Should match the spec formula for every prize index and sum to M", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      const ticketCount = 10; // M = 500 TL, exercises an odd-bit-pattern total
      await setupUser(tlToken, lottery, user1, BigInt(ticketCount * 50));

      const rnds: { rndNumber: bigint; hash: string }[] = [];
      for (let i = 0; i < ticketCount; i++) {
        const rnd = generateRandom(user1.address);
        rnds.push(rnd);
        await lottery.connect(user1).buyTicket(rnd.hash);
      }

      await time.increase(PURCHASE_DURATION + 1);
      for (let i = 0; i < ticketCount; i++) {
        await lottery.connect(user1).revealRndNumber(i + 1, rnds[i].rndNumber);
      }
      await time.increase(REVEAL_DURATION + 1);

      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      const winners = await lottery.getWinningTickets(1);

      // Contract prize count must equal ceil(log2(M)) + 1.
      expect(BigInt(winners.length)).to.equal(expectedPrizeCount(totalMoney));

      // Each prize amount must match the spec formula exactly.
      let sum = 0n;
      for (let i = 1; i <= winners.length; i++) {
        const [, amount] = await lottery.getIthWinningTicket(i, 1);
        expect(amount).to.equal(expectedPrize(totalMoney, BigInt(i)));
        sum += amount;
      }

      // The formula is designed so the prizes telescope to exactly M.
      expect(sum).to.equal(totalMoney);
    });

    it("Should produce prize counts following ceil(log2(M)) + 1 across several M values", async function () {
      // Pure-arithmetic spot checks against the spec formula.
      const cases: [bigint, bigint][] = [
        [1n, 1n],
        [2n, 2n],
        [3n, 3n],
        [4n, 3n],
        [5n, 4n],
        [50n, 7n],   // ceil(log2(50)) = 6
        [500n, 10n], // ceil(log2(500)) = 9
        [1000n, 11n] // ceil(log2(1000)) = 10
      ];
      for (const [M, expected] of cases) {
        expect(expectedPrizeCount(M)).to.equal(expected);
      }
    });
  });

  describe("Full Lottery Cycle", function () {
    it("Should complete a full lottery cycle with multiple users", async function () {
      const { tlToken, lottery, user1, user2, user3 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 200n);
      await setupUser(tlToken, lottery, user2, 200n);
      await setupUser(tlToken, lottery, user3, 200n);

      const rnds = [
        generateRandom(user1.address),
        generateRandom(user2.address),
        generateRandom(user3.address),
      ];

      await lottery.connect(user1).buyTicket(rnds[0].hash);
      await lottery.connect(user2).buyTicket(rnds[1].hash);
      await lottery.connect(user3).buyTicket(rnds[2].hash);

      await time.increase(PURCHASE_DURATION + 1);

      await lottery.connect(user1).revealRndNumber(1, rnds[0].rndNumber);
      await lottery.connect(user2).revealRndNumber(2, rnds[1].rndNumber);
      await lottery.connect(user3).revealRndNumber(3, rnds[2].rndNumber);

      await time.increase(REVEAL_DURATION + 1);

      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);

      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      expect(totalMoney).to.equal(150n);
    });

    it("Should allow winner to collect prize", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);
      await time.increase(PURCHASE_DURATION + 1);
      await lottery.connect(user1).revealRndNumber(1, rndNumber);
      await time.increase(REVEAL_DURATION + 1);

      // With only one ticket, user1 wins all prizes
      await lottery.getWinningTickets(1);

      const [ticketNo, amount] = await lottery.getIthWinningTicket(1, 1);
      expect(ticketNo).to.equal(1n);

      const balanceBefore = await lottery.balances(user1.address);
      await lottery.connect(user1).collectTicketPrize(1, 1);
      const balanceAfter = await lottery.balances(user1.address);

      expect(balanceAfter - balanceBefore).to.equal(amount);
    });

    it("Should not allow double prize collection", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);
      await time.increase(PURCHASE_DURATION + 1);
      await lottery.connect(user1).revealRndNumber(1, rndNumber);
      await time.increase(REVEAL_DURATION + 1);

      await lottery.connect(user1).collectTicketPrize(1, 1);
      await expect(lottery.connect(user1).collectTicketPrize(1, 1)).to.be.revertedWithCustomError(
        lottery,
        "PrizeAlreadyCollected"
      );
    });
  });

  // All multi-user tests below generate fresh wallets at runtime, fund them,
  // then have them buy/reveal — exactly the flow the spec requires.
  describe("Multi-User Tests (dynamic addresses)", function () {
    async function runMultiUserCycle(
      count: number,
      tlToken: TLToken,
      lottery: Lottery,
      owner: HardhatEthersSigner
    ) {
      const users = await generateUsers(count, owner);
      const rnds: { rndNumber: bigint; hash: string }[] = [];

      for (const user of users) {
        await setupDynamicUser(tlToken, lottery, user, 100n);
        const rnd = generateRandom(user.address);
        rnds.push(rnd);
        await lottery.connect(user).buyTicket(rnd.hash);
      }

      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(BigInt(count * 50));

      await time.increase(PURCHASE_DURATION + 1);

      for (let i = 0; i < users.length; i++) {
        await lottery.connect(users[i]).revealRndNumber(i + 1, rnds[i].rndNumber);
      }
      expect(await lottery.getRevealedCount(1)).to.equal(BigInt(count));

      await time.increase(REVEAL_DURATION + 1);

      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);
      return { users, winners };
    }

    it("Should handle 5 dynamically generated users", async function () {
      this.timeout(60000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      await runMultiUserCycle(5, tlToken, lottery, owner);
    });

    it("Should handle 10 dynamically generated users", async function () {
      this.timeout(120000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      await runMultiUserCycle(10, tlToken, lottery, owner);
    });

    it("Should handle 20 dynamically generated users", async function () {
      this.timeout(120000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      await runMultiUserCycle(20, tlToken, lottery, owner);
    });

    it("Should handle 50 dynamically generated users", async function () {
      this.timeout(300000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      await runMultiUserCycle(50, tlToken, lottery, owner);
    });

    it("Should handle 100 dynamically generated users", async function () {
      this.timeout(600000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      const { winners } = await runMultiUserCycle(100, tlToken, lottery, owner);
      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      console.log(`    100 users test: Total money = ${totalMoney} TL, Winners = ${winners.length}`);
    });

    it("Should handle 200 dynamically generated users", async function () {
      this.timeout(1200000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      const { winners } = await runMultiUserCycle(200, tlToken, lottery, owner);
      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      console.log(`    200 users test: Total money = ${totalMoney} TL, Winners = ${winners.length}`);
    });

    it("Should handle 250 dynamically generated users (200+ test)", async function () {
      this.timeout(1500000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      const { winners } = await runMultiUserCycle(250, tlToken, lottery, owner);
      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      console.log(`    250 users test (200+): Total money = ${totalMoney} TL, Winners = ${winners.length}`);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle lottery with no revealed tickets", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);

      // Skip to after lottery ends without revealing
      await time.increase(LOTTERY_DURATION + 1);

      await expect(lottery.getWinningTickets(1)).to.be.revertedWithCustomError(
        lottery,
        "NoRevealedTickets"
      );
    });

    it("Should handle partially revealed tickets", async function () {
      const { tlToken, lottery, user1, user2 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      await setupUser(tlToken, lottery, user2, 100n);

      const rnd1 = generateRandom(user1.address);
      const rnd2 = generateRandom(user2.address);

      await lottery.connect(user1).buyTicket(rnd1.hash);
      await lottery.connect(user2).buyTicket(rnd2.hash);

      await time.increase(PURCHASE_DURATION + 1);

      // Only user1 reveals
      await lottery.connect(user1).revealRndNumber(1, rnd1.rndNumber);

      await time.increase(REVEAL_DURATION + 1);

      // Should only consider revealed ticket
      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);
      expect(await lottery.getRevealedCount(1)).to.equal(1n);
    });

    it("Should handle multiple lotteries correctly", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      // Lottery 1
      await setupUser(tlToken, lottery, user1, 200n);
      const rnd1 = generateRandom(user1.address);
      await lottery.connect(user1).buyTicket(rnd1.hash);

      // Move to lottery 2
      await time.increase(LOTTERY_DURATION);

      expect(await lottery.getCurrentLotteryNo()).to.equal(2n);

      const rnd2 = generateRandom(user1.address);
      await lottery.connect(user1).buyTicket(rnd2.hash);

      // Verify separate lottery data
      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(50n);
      expect(await lottery.getTotalLotteryMoneyCollected(2)).to.equal(50n);
    });

    it("Should transfer ticket and update ownership mapping", async function () {
      const { tlToken, lottery, lotteryTicket, user1, user2 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom(user1.address);

      await lottery.connect(user1).buyTicket(hash);
      await time.increase(PURCHASE_DURATION + 1);
      await lottery.connect(user1).revealRndNumber(1, rndNumber);

      // Check user1 owns ticket
      expect(await lottery.getUserTicketCount(user1.address, 1)).to.equal(1n);
      expect(await lottery.getUserTicketCount(user2.address, 1)).to.equal(0n);

      // Transfer
      await lottery.connect(user1).transferRevealedTicketTo(1, user2.address);

      // Check ownership updated
      expect(await lottery.getUserTicketCount(user1.address, 1)).to.equal(0n);
      expect(await lottery.getUserTicketCount(user2.address, 1)).to.equal(1n);
      expect(await lotteryTicket.ownerOf(1)).to.equal(user2.address);
    });
  });

  describe("Prize Distribution Tests", function () {
    it("Should distribute all money through prizes", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      // Buy multiple tickets
      const ticketCount = 10;
      await setupUser(tlToken, lottery, user1, BigInt(ticketCount * 50));
      const rnds: { rndNumber: bigint; hash: string }[] = [];

      for (let i = 0; i < ticketCount; i++) {
        const rnd = generateRandom(user1.address);
        rnds.push(rnd);
        await lottery.connect(user1).buyTicket(rnd.hash);
      }

      await time.increase(PURCHASE_DURATION + 1);

      for (let i = 0; i < ticketCount; i++) {
        await lottery.connect(user1).revealRndNumber(i + 1, rnds[i].rndNumber);
      }

      await time.increase(REVEAL_DURATION + 1);

      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      const winners = await lottery.getWinningTickets(1);

      // Collect all prizes (user1 owns every ticket in this scenario)
      let totalPrizes = 0n;
      for (let i = 1; i <= winners.length; i++) {
        const [ticketNo, amount] = await lottery.getIthWinningTicket(i, 1);
        await lottery.connect(user1).collectTicketPrize(ticketNo, i);
        totalPrizes += amount;
      }

      // Total prizes should equal total money
      expect(totalPrizes).to.equal(totalMoney);
    });
  });

  describe("Stage Transitions", function () {
    it("Should correctly identify purchase stage", async function () {
      const { lottery } = await loadFixture(deployLotteryFixture);

      expect(await lottery.isInPurchaseStage(1)).to.equal(true);
      expect(await lottery.isInRevealStage(1)).to.equal(false);
      expect(await lottery.isLotteryEnded(1)).to.equal(false);
    });

    it("Should correctly identify reveal stage", async function () {
      const { lottery } = await loadFixture(deployLotteryFixture);

      await time.increase(PURCHASE_DURATION + 1);

      expect(await lottery.isInPurchaseStage(1)).to.equal(false);
      expect(await lottery.isInRevealStage(1)).to.equal(true);
      expect(await lottery.isLotteryEnded(1)).to.equal(false);
    });

    it("Should correctly identify lottery ended", async function () {
      const { lottery } = await loadFixture(deployLotteryFixture);

      await time.increase(LOTTERY_DURATION + 1);

      expect(await lottery.isInPurchaseStage(1)).to.equal(false);
      expect(await lottery.isInRevealStage(1)).to.equal(false);
      expect(await lottery.isLotteryEnded(1)).to.equal(true);
    });
  });
});
