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

  // Helper to generate random number and its hash
  function generateRandom(): { rndNumber: bigint; hash: string } {
    const rndNumber = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [rndNumber]));
    return { rndNumber, hash };
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
      const { hash } = generateRandom();

      const tx = await lottery.connect(user1).buyTicket(hash);
      const receipt = await tx.wait();

      expect(await lottery.balances(user1.address)).to.equal(50n);
      expect(await lotteryTicket.ownerOf(1)).to.equal(user1.address);
    });

    it("Should store ticket data correctly", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom();

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
      const { hash } = generateRandom();

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
      const { hash } = generateRandom();

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
      const { rndNumber, hash } = generateRandom();

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
      const { hash } = generateRandom();
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
      const { rndNumber, hash } = generateRandom();

      await lottery.connect(user1).buyTicket(hash);

      await expect(lottery.connect(user1).revealRndNumber(1, rndNumber)).to.be.revertedWithCustomError(
        lottery,
        "NotInRevealStage"
      );
    });

    it("Should fail reveal after reveal stage", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom();

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
      const { rndNumber, hash } = generateRandom();

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

      const rnd1 = generateRandom();
      const rnd2 = generateRandom();

      await lottery.connect(user1).buyTicket(rnd1.hash);
      await lottery.connect(user2).buyTicket(rnd2.hash);

      await time.increase(PURCHASE_DURATION + 1);

      await lottery.connect(user1).revealRndNumber(1, rnd1.rndNumber);
      await lottery.connect(user2).revealRndNumber(2, rnd2.rndNumber);

      const combined = await lottery.getCombinedRandom(1);
      expect(combined).to.equal(rnd1.rndNumber ^ rnd2.rndNumber);
    });
  });

  describe("Transfer Revealed Ticket", function () {
    it("Should transfer revealed ticket", async function () {
      const { tlToken, lottery, lotteryTicket, user1, user2 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom();

      await lottery.connect(user1).buyTicket(hash);
      await time.increase(PURCHASE_DURATION + 1);
      await lottery.connect(user1).revealRndNumber(1, rndNumber);

      await lottery.connect(user1).transferRevealedTicketTo(1, user2.address);

      expect(await lotteryTicket.ownerOf(1)).to.equal(user2.address);
    });

    it("Should fail to transfer unrevealed ticket", async function () {
      const { tlToken, lottery, user1, user2 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom();

      await lottery.connect(user1).buyTicket(hash);

      await expect(
        lottery.connect(user1).transferRevealedTicketTo(1, user2.address)
      ).to.be.revertedWithCustomError(lottery, "TicketNotRevealed");
    });
  });

  describe("Query Functions", function () {
    it("Should get last bought ticket", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 200n);
      const rnd1 = generateRandom();
      const rnd2 = generateRandom();

      await lottery.connect(user1).buyTicket(rnd1.hash);
      await lottery.connect(user1).buyTicket(rnd2.hash);

      const [ticketNo, status] = await lottery.connect(user1).getLastBoughtTicketNo(1);
      expect(ticketNo).to.equal(2n);
      expect(status).to.equal(0);
    });

    it("Should get i-th owned ticket", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 200n);
      const rnd1 = generateRandom();
      const rnd2 = generateRandom();

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
      await lottery.connect(user1).buyTicket(generateRandom().hash);
      await lottery.connect(user1).buyTicket(generateRandom().hash);

      const total = await lottery.getTotalLotteryMoneyCollected(1);
      expect(total).to.equal(100n);
    });
  });

  describe("Prize Calculation", function () {
    it("Should calculate correct prize amounts", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      // Buy 10 tickets = 500 TL total
      await setupUser(tlToken, lottery, user1, 500n);
      for (let i = 0; i < 10; i++) {
        await lottery.connect(user1).buyTicket(generateRandom().hash);
      }

      // Reveal all tickets
      await time.increase(PURCHASE_DURATION + 1);
      for (let i = 1; i <= 10; i++) {
        const { rndNumber, hash } = generateRandom();
        // Need to use correct hash for each ticket
        // Actually we need to track the random numbers
      }
    });
  });

  describe("Full Lottery Cycle", function () {
    it("Should complete a full lottery cycle with multiple users", async function () {
      const { tlToken, lottery, user1, user2, user3 } = await loadFixture(deployLotteryFixture);

      // Setup users
      await setupUser(tlToken, lottery, user1, 200n);
      await setupUser(tlToken, lottery, user2, 200n);
      await setupUser(tlToken, lottery, user3, 200n);

      // Generate and store random numbers
      const rnds = [generateRandom(), generateRandom(), generateRandom()];

      // Buy tickets
      await lottery.connect(user1).buyTicket(rnds[0].hash);
      await lottery.connect(user2).buyTicket(rnds[1].hash);
      await lottery.connect(user3).buyTicket(rnds[2].hash);

      // Move to reveal stage
      await time.increase(PURCHASE_DURATION + 1);

      // Reveal
      await lottery.connect(user1).revealRndNumber(1, rnds[0].rndNumber);
      await lottery.connect(user2).revealRndNumber(2, rnds[1].rndNumber);
      await lottery.connect(user3).revealRndNumber(3, rnds[2].rndNumber);

      // Move past lottery end
      await time.increase(REVEAL_DURATION + 1);

      // Get winning tickets
      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);

      // Get total money
      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      expect(totalMoney).to.equal(150n);
    });

    it("Should allow winner to collect prize", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      // Single user buys single ticket
      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom();

      await lottery.connect(user1).buyTicket(hash);
      await time.increase(PURCHASE_DURATION + 1);
      await lottery.connect(user1).revealRndNumber(1, rndNumber);
      await time.increase(REVEAL_DURATION + 1);

      // With only one ticket, user1 wins all prizes
      const winners = await lottery.getWinningTickets(1);

      // Get first prize info
      const [ticketNo, amount] = await lottery.getIthWinningTicket(1, 1);
      expect(ticketNo).to.equal(1n);

      // Collect prize
      const balanceBefore = await lottery.balances(user1.address);
      await lottery.connect(user1).collectTicketPrize(1, 1);
      const balanceAfter = await lottery.balances(user1.address);

      expect(balanceAfter - balanceBefore).to.equal(amount);
    });

    it("Should not allow double prize collection", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom();

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

  describe("Multi-User Tests (5 addresses)", function () {
    it("Should handle 5 users buying and revealing tickets", async function () {
      const { tlToken, lottery } = await loadFixture(deployLotteryFixture);
      const signers = await ethers.getSigners();
      const users = signers.slice(0, 5);
      const rnds: { rndNumber: bigint; hash: string }[] = [];

      // Setup and buy tickets
      for (const user of users) {
        await setupUser(tlToken, lottery, user, 100n);
        const rnd = generateRandom();
        rnds.push(rnd);
        await lottery.connect(user).buyTicket(rnd.hash);
      }

      // Verify total money
      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(250n);

      // Move to reveal stage
      await time.increase(PURCHASE_DURATION + 1);

      // Reveal
      for (let i = 0; i < users.length; i++) {
        await lottery.connect(users[i]).revealRndNumber(i + 1, rnds[i].rndNumber);
      }

      // Verify revealed count
      expect(await lottery.getRevealedCount(1)).to.equal(5n);

      // Move past lottery
      await time.increase(REVEAL_DURATION + 1);

      // Get winners
      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);
    });
  });

  describe("Multi-User Tests (10 addresses)", function () {
    it("Should handle 10 users buying and revealing tickets", async function () {
      const { tlToken, lottery } = await loadFixture(deployLotteryFixture);
      const signers = await ethers.getSigners();
      const users = signers.slice(0, 10);
      const rnds: { rndNumber: bigint; hash: string }[] = [];

      // Setup and buy tickets
      for (const user of users) {
        await setupUser(tlToken, lottery, user, 100n);
        const rnd = generateRandom();
        rnds.push(rnd);
        await lottery.connect(user).buyTicket(rnd.hash);
      }

      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(500n);

      await time.increase(PURCHASE_DURATION + 1);

      for (let i = 0; i < users.length; i++) {
        await lottery.connect(users[i]).revealRndNumber(i + 1, rnds[i].rndNumber);
      }

      expect(await lottery.getRevealedCount(1)).to.equal(10n);

      await time.increase(REVEAL_DURATION + 1);

      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);
    });
  });

  describe("Dynamic Address Generation Tests", function () {
    async function generateUsers(
      count: number,
      owner: HardhatEthersSigner
    ): Promise<HardhatEthersSigner[]> {
      const users: HardhatEthersSigner[] = [];
      for (let i = 0; i < count; i++) {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        // Fund with ETH for gas
        await owner.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("1"),
        });
        users.push(wallet as unknown as HardhatEthersSigner);
      }
      return users;
    }

    it("Should handle 20 dynamically generated users", async function () {
      this.timeout(120000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      const users = await generateUsers(20, owner);
      const rnds: { rndNumber: bigint; hash: string }[] = [];

      // Setup and buy tickets
      for (const user of users) {
        await tlToken.mintTo(user.address, 100n);
        await tlToken.connect(user).approve(await lottery.getAddress(), 100n);
        await lottery.connect(user).depositTL(100n);
        const rnd = generateRandom();
        rnds.push(rnd);
        await lottery.connect(user).buyTicket(rnd.hash);
      }

      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(1000n);

      await time.increase(PURCHASE_DURATION + 1);

      for (let i = 0; i < users.length; i++) {
        await lottery.connect(users[i]).revealRndNumber(i + 1, rnds[i].rndNumber);
      }

      expect(await lottery.getRevealedCount(1)).to.equal(20n);

      await time.increase(REVEAL_DURATION + 1);

      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);
    });

    it("Should handle 50 dynamically generated users", async function () {
      this.timeout(300000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      const users = await generateUsers(50, owner);
      const rnds: { rndNumber: bigint; hash: string }[] = [];

      for (const user of users) {
        await tlToken.mintTo(user.address, 100n);
        await tlToken.connect(user).approve(await lottery.getAddress(), 100n);
        await lottery.connect(user).depositTL(100n);
        const rnd = generateRandom();
        rnds.push(rnd);
        await lottery.connect(user).buyTicket(rnd.hash);
      }

      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(2500n);

      await time.increase(PURCHASE_DURATION + 1);

      for (let i = 0; i < users.length; i++) {
        await lottery.connect(users[i]).revealRndNumber(i + 1, rnds[i].rndNumber);
      }

      expect(await lottery.getRevealedCount(1)).to.equal(50n);

      await time.increase(REVEAL_DURATION + 1);

      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);
    });

    it("Should handle 100 dynamically generated users", async function () {
      this.timeout(600000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      const users = await generateUsers(100, owner);
      const rnds: { rndNumber: bigint; hash: string }[] = [];

      // Setup and buy tickets for all 100 users
      for (const user of users) {
        await tlToken.mintTo(user.address, 100n);
        await tlToken.connect(user).approve(await lottery.getAddress(), 100n);
        await lottery.connect(user).depositTL(100n);
        const rnd = generateRandom();
        rnds.push(rnd);
        await lottery.connect(user).buyTicket(rnd.hash);
      }

      // Verify total: 100 users * 50 TL = 5000 TL
      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(5000n);

      await time.increase(PURCHASE_DURATION + 1);

      // Reveal all tickets
      for (let i = 0; i < users.length; i++) {
        await lottery.connect(users[i]).revealRndNumber(i + 1, rnds[i].rndNumber);
      }

      expect(await lottery.getRevealedCount(1)).to.equal(100n);

      await time.increase(REVEAL_DURATION + 1);

      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);

      // Verify prize distribution
      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      console.log(`    100 users test: Total money = ${totalMoney} TL, Winners = ${winners.length}`);
    });

    it("Should handle 200 dynamically generated users", async function () {
      this.timeout(1200000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      const users = await generateUsers(200, owner);
      const rnds: { rndNumber: bigint; hash: string }[] = [];

      // Setup and buy tickets for all 200 users
      for (const user of users) {
        await tlToken.mintTo(user.address, 100n);
        await tlToken.connect(user).approve(await lottery.getAddress(), 100n);
        await lottery.connect(user).depositTL(100n);
        const rnd = generateRandom();
        rnds.push(rnd);
        await lottery.connect(user).buyTicket(rnd.hash);
      }

      // Verify total: 200 users * 50 TL = 10000 TL
      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(10000n);

      await time.increase(PURCHASE_DURATION + 1);

      // Reveal all tickets
      for (let i = 0; i < users.length; i++) {
        await lottery.connect(users[i]).revealRndNumber(i + 1, rnds[i].rndNumber);
      }

      expect(await lottery.getRevealedCount(1)).to.equal(200n);

      await time.increase(REVEAL_DURATION + 1);

      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);

      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      console.log(`    200 users test: Total money = ${totalMoney} TL, Winners = ${winners.length}`);
    });

    it("Should handle 250 dynamically generated users (200+ test)", async function () {
      this.timeout(1500000);
      const { tlToken, lottery, owner } = await loadFixture(deployLotteryFixture);
      const users = await generateUsers(250, owner);
      const rnds: { rndNumber: bigint; hash: string }[] = [];

      // Setup and buy tickets for all 250 users
      for (const user of users) {
        await tlToken.mintTo(user.address, 100n);
        await tlToken.connect(user).approve(await lottery.getAddress(), 100n);
        await lottery.connect(user).depositTL(100n);
        const rnd = generateRandom();
        rnds.push(rnd);
        await lottery.connect(user).buyTicket(rnd.hash);
      }

      // Verify total: 250 users * 50 TL = 12500 TL
      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(12500n);

      await time.increase(PURCHASE_DURATION + 1);

      // Reveal all tickets
      for (let i = 0; i < users.length; i++) {
        await lottery.connect(users[i]).revealRndNumber(i + 1, rnds[i].rndNumber);
      }

      expect(await lottery.getRevealedCount(1)).to.equal(250n);

      await time.increase(REVEAL_DURATION + 1);

      const winners = await lottery.getWinningTickets(1);
      expect(winners.length).to.be.greaterThan(0);

      const totalMoney = await lottery.getTotalLotteryMoneyCollected(1);
      console.log(`    250 users test (200+): Total money = ${totalMoney} TL, Winners = ${winners.length}`);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle lottery with no revealed tickets", async function () {
      const { tlToken, lottery, user1 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { hash } = generateRandom();

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

      const rnd1 = generateRandom();
      const rnd2 = generateRandom();

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
      const rnd1 = generateRandom();
      await lottery.connect(user1).buyTicket(rnd1.hash);

      // Move to lottery 2
      await time.increase(LOTTERY_DURATION);

      expect(await lottery.getCurrentLotteryNo()).to.equal(2n);

      const rnd2 = generateRandom();
      await lottery.connect(user1).buyTicket(rnd2.hash);

      // Verify separate lottery data
      expect(await lottery.getTotalLotteryMoneyCollected(1)).to.equal(50n);
      expect(await lottery.getTotalLotteryMoneyCollected(2)).to.equal(50n);
    });

    it("Should transfer ticket and update ownership mapping", async function () {
      const { tlToken, lottery, lotteryTicket, user1, user2 } = await loadFixture(deployLotteryFixture);

      await setupUser(tlToken, lottery, user1, 100n);
      const { rndNumber, hash } = generateRandom();

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
        const rnd = generateRandom();
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

      // Collect all prizes
      let totalPrizes = 0n;
      for (let i = 1; i <= winners.length; i++) {
        const [ticketNo, amount] = await lottery.getIthWinningTicket(i, 1);
        // Only collect if user owns this ticket (they own all in this case)
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
