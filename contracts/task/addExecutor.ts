import { HardhatRuntimeEnvironment } from 'hardhat/types';
import fetch from 'node-fetch';
import moment from 'moment-timezone';
const task = async (args: any, hre: HardhatRuntimeEnvironment) => {
  const { ethers, getNamedAccounts, deployments } = hre;
  const chain = hre.hardhatArguments.network ? hre.hardhatArguments.network : 'wedid_dev';
  const [deployer, acct1] = await ethers.getSigners();
  const monitor = (await ethers.getContractAt('NftTradeMonitor', (await deployments.get('NftTradeMonitor')).address)).connect(deployer);
  console.log(await monitor.containsExecutor(args.executor));
  const tx = await monitor.addExecutor(args.executor);
  console.log(`🔵chain[${chain}] addExecutor tx(${tx.hash}) pending...`);
  await tx.wait();
  console.log(`✅chain[${chain}] addExecutor tx(${tx.hash}) success.`);
};
export default task;
