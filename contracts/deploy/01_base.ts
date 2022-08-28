import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const monitor = await deploy('NftTradeMonitor', {
    from: deployer,
    args: [],
    log: true,
    proxy: {
      proxyContract: 'OpenZeppelinTransparentProxy',
      owner: deployer,
      execute: { init: { methodName: 'initialize', args: [] } },
    },
  });
  console.log(`🟢[${hre.network.name}] monitor address: ${monitor.address}`);
};
export default func;
