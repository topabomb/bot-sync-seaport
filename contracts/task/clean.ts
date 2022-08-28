import { HardhatRuntimeEnvironment } from 'hardhat/types';
import fetch from 'node-fetch';
import moment from 'moment-timezone';
const task = async (args: any, hre: HardhatRuntimeEnvironment) => {
  const { ethers, getNamedAccounts, deployments } = hre;
  const chain = hre.hardhatArguments.network ? hre.hardhatArguments.network : 'wedid_dev';
  const [deployer, acct1] = await ethers.getSigners();
  const monitor = (await ethers.getContractAt('NftTradeMonitor', (await deployments.get('NftTradeMonitor')).address)).connect(deployer);
  const gasLimit = await monitor.estimateGas.clean();
  console.log(gasLimit);
  const tx = await monitor.clean({ gasLimit });
  console.log(`🔵chain[${chain}] clean tx(${tx.hash}) pending...`);
  await tx.wait();
  console.log(`✅chain[${chain}] clean tx(${tx.hash}) success.`);
};
export default task;
