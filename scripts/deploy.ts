import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Deploy TLToken
  console.log("\n1. Deploying TLToken...");
  const TLToken = await ethers.getContractFactory("TLToken");
  const tlToken = await TLToken.deploy();
  await tlToken.waitForDeployment();
  const tlTokenAddress = await tlToken.getAddress();
  console.log("TLToken deployed to:", tlTokenAddress);

  // Deploy LotteryTicket
  console.log("\n2. Deploying LotteryTicket...");
  const LotteryTicket = await ethers.getContractFactory("LotteryTicket");
  const lotteryTicket = await LotteryTicket.deploy();
  await lotteryTicket.waitForDeployment();
  const lotteryTicketAddress = await lotteryTicket.getAddress();
  console.log("LotteryTicket deployed to:", lotteryTicketAddress);

  // Deploy Lottery
  console.log("\n3. Deploying Lottery...");
  const Lottery = await ethers.getContractFactory("Lottery");
  const lottery = await Lottery.deploy(tlTokenAddress, lotteryTicketAddress);
  await lottery.waitForDeployment();
  const lotteryAddress = await lottery.getAddress();
  console.log("Lottery deployed to:", lotteryAddress);

  // Set Lottery as minter for LotteryTicket
  console.log("\n4. Setting Lottery as minter for LotteryTicket...");
  const tx = await lotteryTicket.setLotteryContract(lotteryAddress);
  await tx.wait();
  console.log("Lottery set as minter for LotteryTicket");

  // Print summary
  console.log("\n========== Deployment Summary ==========");
  console.log("TLToken:       ", tlTokenAddress);
  console.log("LotteryTicket: ", lotteryTicketAddress);
  console.log("Lottery:       ", lotteryAddress);
  console.log("=========================================");

  // Get lottery start time
  const startTime = await lottery.startTime();
  console.log("\nLottery start time:", new Date(Number(startTime) * 1000).toISOString());

  // Return addresses for programmatic use
  return {
    tlToken: tlTokenAddress,
    lotteryTicket: lotteryTicketAddress,
    lottery: lotteryAddress,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
