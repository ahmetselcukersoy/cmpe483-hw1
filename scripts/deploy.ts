import { network } from "hardhat";

async function main() {
  // Hardhat 3: open a network connection explicitly.
  const { ethers } = await network.create();

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Deploy TLToken
  console.log("\n1. Deploying TLToken...");
  const tlToken = await ethers.deployContract("TLToken");
  await tlToken.waitForDeployment();
  const tlTokenAddress = await tlToken.getAddress();
  console.log("TLToken deployed to:", tlTokenAddress);

  // Deploy LotteryTicket
  console.log("\n2. Deploying LotteryTicket...");
  const lotteryTicket = await ethers.deployContract("LotteryTicket");
  await lotteryTicket.waitForDeployment();
  const lotteryTicketAddress = await lotteryTicket.getAddress();
  console.log("LotteryTicket deployed to:", lotteryTicketAddress);

  // Deploy Lottery
  console.log("\n3. Deploying Lottery...");
  const lottery = await ethers.deployContract("Lottery", [
    tlTokenAddress,
    lotteryTicketAddress,
  ]);
  await lottery.waitForDeployment();
  const lotteryAddress = await lottery.getAddress();
  console.log("Lottery deployed to:", lotteryAddress);

  // Wire Lottery as the authorised minter for LotteryTicket
  console.log("\n4. Setting Lottery as minter for LotteryTicket...");
  const tx = await lotteryTicket.setLotteryContract(lotteryAddress);
  await tx.wait();
  console.log("Lottery set as minter for LotteryTicket");

  console.log("\n========== Deployment Summary ==========");
  console.log("TLToken:       ", tlTokenAddress);
  console.log("LotteryTicket: ", lotteryTicketAddress);
  console.log("Lottery:       ", lotteryAddress);
  console.log("=========================================");

  const startTime = await lottery.startTime();
  console.log(
    "\nLottery start time:",
    new Date(Number(startTime) * 1000).toISOString()
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
