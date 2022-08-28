import 'dotenv/config';
import { configure, getLogger } from 'log4js';
import log4js_main from './settings/log4js_main.json';
//configure(`${__dirname}/settings/log4js_main.json`);
configure(log4js_main);
const logger = getLogger();
import { ethers } from 'ethers';

import jsonChains from './settings/chains.json';
const chainsCfg = jsonChains as Record<string, { rpcUrls: string[]; chainId: string }>;
import abiMonitor from './abis/NftTradeMonitor.json';

const WEDID_RPC_URL = process.env.WEDID_RPC_URL ? process.env.WEDID_RPC_URL : chainsCfg['wedid_dev'].rpcUrls[0];

const report = async (monitor: ethers.Contract) => {
  console.log(
    '合约总数:',
    (await monitor.getContractCount()).toString(),
    '藏品总数:',
    (await monitor.getItemCount()).toString()
  );
};
const main = async (network: string) => {
  const provider = new ethers.providers.JsonRpcProvider(WEDID_RPC_URL);
  const wallet = ethers.Wallet.fromMnemonic(process.env.MNEMONIC as string).connect(provider);
  const monitor = new ethers.Contract(abiMonitor.address, abiMonitor.abi, provider).connect(wallet);
  const logs = await monitor.queryFilter('SeaportOrderFulfilled', -10, 'latest');
  console.log(logs.length);
  let latest = await provider.getBlockNumber();
  let timestamp = (await provider.getBlock('latest')).timestamp;
  provider.on('block', async (number) => {
    latest = number;
    timestamp = (await provider.getBlock(number)).timestamp;
    const logs = await monitor.queryFilter('SeaportOrderFulfilled', number, number);
    console.log(`number:${number},timestamp:${timestamp},logs:${logs.length}`);
    await report(monitor);
  });
  monitor.on('SeaportOrderFulfilled', async (chainId, tranHash, logIndex) => {
    //console.log(`wedid(${latest}:${timestamp}):${network}原交易：${chainId.toString()}#${tranHash}#${logIndex}`);
  });
};
void main('ethereum');
