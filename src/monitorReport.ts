import 'dotenv/config';
import { configure, getLogger } from 'log4js';
import log4js_main from './constants/log4js_main.json';
//configure(`${__dirname}/constants/log4js_main.json`);
configure(log4js_main);
const logger = getLogger();
import { ethers } from 'ethers';

import jsonChains from './constants/chains.json';
const chainsCfg = jsonChains as Record<string, { rpcUrls: string[]; chainId: string }>;
import abiMonitor from './abis/NftTradeMonitor.json';

import { Get_ProviderWithProxy } from './utils';

import { program } from 'commander'; //https://github.com/tj/commander.js/blob/master/Readme_zh-CN.md
program
  .option('-m,--mnemonic <助记词>', '替代.env中的助记词')
  .option('-r,--wedid-rpc <RPC地址>', '替代内置RPC', chainsCfg['wedid_dev'].rpcUrls[0])
  .option('-p,--proxy <服务器地址>', '使用代理服务器');
const CommandLineArgs = program.parse().opts();
console.log(CommandLineArgs);
const WEDID_RPC_URL = CommandLineArgs.wedidRpc;
const MNEMONIC: string = CommandLineArgs.mnemonic ? CommandLineArgs.mnemonic : process.env.MNEMONIC;
const report = async (monitor: ethers.Contract) => {
  console.log(
    '合约总数:',
    (await monitor.getContractCount()).toString(),
    '藏品总数:',
    (await monitor.getItemCount()).toString()
  );
};
const main = async (network: string) => {
  const provider = Get_ProviderWithProxy(WEDID_RPC_URL, CommandLineArgs.proxy);
  const wallet = ethers.Wallet.fromMnemonic(MNEMONIC).connect(provider);
  const monitor = new ethers.Contract(abiMonitor.address, abiMonitor.abi, provider).connect(wallet);
  const logs = await monitor.queryFilter('SeaportOrderFulfilled', -1, 'latest');
  console.log(logs.length, monitor.interface.getSighash(monitor.interface.getEvent('SeaportOrderFulfilled'))); //0x9d9af8e3
  if (logs.length > 0) console.log(JSON.stringify({ ...monitor.interface.parseLog(logs[0]).args }));
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
