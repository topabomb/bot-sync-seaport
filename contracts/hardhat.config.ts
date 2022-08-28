import { HardhatUserConfig, task } from 'hardhat/config';
import 'dotenv/config';
import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-deploy';
import '@openzeppelin/hardhat-upgrades';
import 'hardhat-tracer';
import 'hardhat-gas-reporter';
import './task';

task('accounts', 'list ethers accounts with balance').setAction(async (taskArgs, hre) => {
  for (const account of await hre.ethers.getSigners())
    console.log(account.address, hre.ethers.utils.formatEther(await account.getBalance()));
});
const getMnemonic = (networkName?: string) => {
  const mnemonic = networkName ? process.env['MNEMONIC_' + networkName.toUpperCase()] : process.env.MNEMONIC;
  if (!mnemonic || mnemonic === '') return 'test test test test test test test test test test test junk';
  return mnemonic;
};
const accounts = (chain?: string) => {
  return { mnemonic: getMnemonic(chain) };
};
const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.9',
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    ],
  },
  namedAccounts: {
    deployer: 0,
  },
  networks: {
    hardhat: {
      accounts: accounts(),
    },
    wedid_dev: {
      url: 'https://devchain.nawarat.io',
      chainId: 1942,
      accounts: accounts(),
    },
    rinkeby: {
      url: 'https://eth-rinkeby.alchemyapi.io/v2/Y_7aHQXYbvh1SvTy-rO95YDvdp21DIeh', // topabomb endpoint
      chainId: 4,
      accounts: accounts(),
      gasMultiplier: 1.1,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS ? true : false,
  },
};

export default config;
