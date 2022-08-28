import 'dotenv/config';
import { configure, getLogger } from 'log4js';
import log4js_main from './settings/log4js_main.json';
//configure(`${__dirname}/settings/log4js_main.json`);
configure(log4js_main);
const logger = getLogger();
import { ethers } from 'ethers';

import jsonChains from './settings/chains.json';
const chainsCfg = jsonChains as Record<string, { rpcUrls: string[]; chainId: string }>;
import jsonSeaport from './settings/seaport.json';
const seaportCfg = jsonSeaport as Record<string, { Seaport: string; DeployAfterNumber: number }>;
import abiSeaport from './abis/seaport.json';
import abiMonitor from './abis/NftTradeMonitor.json';
import { openSync, writeSync, readFileSync, access, constants, closeSync } from 'fs';
const report = async (monitor: ethers.Contract) => {
  console.log(
    '合约总数:',
    (await monitor.getContractCount()).toString(),
    '藏品总数:',
    (await monitor.getItemCount()).toString()
  );
};
const main = async (network: string) => {
  const provider = new ethers.providers.JsonRpcProvider(chainsCfg['wedid_dev'].rpcUrls[0]);
  const wallet = ethers.Wallet.fromMnemonic(process.env.MNEMONIC as string).connect(provider);
  const monitor = new ethers.Contract(abiMonitor.address, abiMonitor.abi, provider).connect(wallet);
  const logs = await monitor.queryFilter('SeaportOrderFulfilled', -10, 'latest');
  console.log(logs.length);
  report(monitor);
  monitor.on('SeaportOrderFulfilled', async (chainId, tranHash, logIndex) => {
    console.log(`${network}交易：${chainId.toString()}#${tranHash}#${logIndex}#`);
  });
};
void main('ethereum');
