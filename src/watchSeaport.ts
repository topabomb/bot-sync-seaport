import { readFileSync } from 'fs';
import * as json5 from 'json5';
import { ethers } from 'ethers';
import cliProgress from 'cli-progress';
import 'dotenv/config';
import { configure, getLogger } from 'log4js';
configure(`${__dirname}/constants/log4js_main.json`);
const logger = getLogger();
import { getProviderWithProxy, fetchEventsByContract, waitAsyncTrans, Sleep } from './utils';
import { State, STATE_PARTIAL_BASE } from './state';

import jsonChains from './constants/chains.json';
const chainsCfg = jsonChains as Record<string, { rpcUrls: string[]; chainId: string }>;
import jsonSeaport from './constants/seaport.json';
const seaportCfg = jsonSeaport as Record<string, { Seaport: string; DeployAfterNumber: number }>;
import abiSeaport from './abis/seaport.json';
import abiMonitor from './abis/NftTradeMonitor.json';
import { program } from 'commander'; //https://github.com/tj/commander.js/blob/master/Readme_zh-CN.md
program
  .requiredOption('-c,--config <文件路径>', 'JSON配置文件', './configures/watchSeaport.json')
  .option('-m,--mnemonic <助记词>', '替代.env中的助记词')
  .option('-r,--rpc <RPC地址>', '替代内置RPC')
  .option('-p,--proxy <服务器地址>', '使用代理服务器');
const CommandLineArgs = program.parse().opts();
const CONFIG = json5.parse(readFileSync(CommandLineArgs.config, 'utf-8'));
//config配置文件中的可配置项目
const CHAIN_NAME = CONFIG.args.CHAIN_NAME ? CONFIG.args.CHAIN_NAME : 'ethereum';
const WEDID_RPC_URL = CONFIG.args.WEDID_RPC_URL ? CONFIG.args.WEDID_RPC_URL : chainsCfg['wedid_dev'].rpcUrls[0];
const BLOCK_BATCH_COUNT = CONFIG.args.BLOCK_BATCH_COUNT ? Number(CONFIG.args.BLOCK_BATCH_COUNT) : 256;
const COMPACT_INTERVAL = CONFIG.args.COMPACT_INTERVAL ? Number(CONFIG.args.COMPACT_INTERVAL) : 1000 * 0.2;
const RELAX_INTERVAL = CONFIG.args.RELAX_INTERVAL ? Number(CONFIG.args.RELAX_INTERVAL) : 1000 * 30;
const STATE_FILE = CONFIG.args.STATE_FILE ? CONFIG.args.STATE_FILE : './.state';
const SEND_BATCH_COUNT = CONFIG.args.SEND_BATCH_COUNT ? Number(CONFIG.args.SEND_BATCH_COUNT) : 96;
const ASYNC_NUMBER = CONFIG.args.ASYNC_NUMBER ? Number(CONFIG.args.ASYNC_NUMBER) : 8;
const WAIT_CONFIRMATION_INTERVAL = CONFIG.args.WAIT_CONFIRMATION_INTERVAL
  ? Number(CONFIG.args.WAIT_CONFIRMATION_INTERVAL)
  : 20 * 1000;
//如下是可用命令行参数替换的配置
const MNEMONIC: string = CommandLineArgs.mnemonic ? CommandLineArgs.mnemonic : process.env.MNEMONIC;
const RPC_URL = CommandLineArgs.rpc ? CommandLineArgs.rpc : chainsCfg[CHAIN_NAME].rpcUrls[0];
interface EVENT_TYPE {
  block: number;
  transactionHash: string;
  logIndex: number;
  event: any;
}
const getStateKey = (transactionHash: string, logIndex: number) => {
  return `${transactionHash}#${logIndex}`;
};

const sendToChain = async (network: string, state: State<STATE_PARTIAL_BASE>, events: EVENT_TYPE[]) => {
  const provider = getProviderWithProxy(WEDID_RPC_URL, CommandLineArgs.proxy);
  const wallet = ethers.Wallet.fromMnemonic(MNEMONIC).connect(provider);
  const monitor = new ethers.Contract(abiMonitor.address, abiMonitor.abi, provider).connect(wallet);
  logger.info(
    `sendToChain:address(${wallet.address}),balance(${ethers.utils.formatEther(
      await wallet.getBalance()
    )},tranCount(${await wallet.getTransactionCount()})`
  );
  logger.warn(`sendToChain:events has ${events.length},pendings has ${state.pendingsLength}`);
  //先保存本次尚未处理的交易
  for (const evt of events) {
    await state.put(getStateKey(evt.transactionHash, evt.logIndex), { ...evt });
  }
  const asyncQueue = [] as { tx: ethers.providers.TransactionResponse; pendingOrders: EVENT_TYPE[] }[];
  //处理队列
  while (state.pendingsLength >= SEND_BATCH_COUNT) {
    let verified = 0;
    const sendOrders = [];
    const bar = new cliProgress.SingleBar({
      format: 'checking containsEvent [{bar}] {percentage}% | {value}/{total} | ETA: {eta}s',
    });
    bar.start(state.pendingsLength, 0);
    let progress = 0;
    do {
      const evt = await state.pop();
      if (evt) {
        const existent = await monitor.containsEvent(chainsCfg[network].chainId, evt.transactionHash, evt.logIndex);
        if (!existent) sendOrders.push(evt);
        else await state.del(getStateKey(evt.transactionHash, evt.logIndex));
        verified++;
        bar.update(++progress);
      }
    } while (sendOrders.length < SEND_BATCH_COUNT && state.pendingsLength > 0);
    bar.setTotal(progress);
    bar.stop();
    logger.warn(`sendToChain:verified(${verified}),sendOrders(${sendOrders.length}),pendings(${state.pendingsLength})`);
    //发送交易
    if (sendOrders.length > 0) {
      let gasLimit;
      try {
        gasLimit = await monitor.estimateGas.seaportOrderFulfilledBatch(
          sendOrders.map((v) => v.event),
          chainsCfg[network].chainId,
          sendOrders.map((v) => v.transactionHash),
          sendOrders.map((v) => v.logIndex)
        );
      } catch (err) {
        const error = err as any;
        if (error.reason && error.error)
          logger.error(
            `sendToChain seaportOrderFulfilledBatch estimateGas reason:${error.reason},message:${error.error.message},data:${error.error.data}`
          );
        else logger.error(`sendToChain seaportOrderFulfilledBatch estimateGas err:${err as Error}`);
      }
      if (gasLimit) {
        gasLimit = Math.round(Number(gasLimit) * 0.7); //TODO:好像无用frontier中针对estimateGas似乎有个倍数处理，暂时除以经验值，参考地址https://github.com/paritytech/frontier/issues/76
        const gasPrice = await provider.getGasPrice();
        try {
          const tx = await monitor.seaportOrderFulfilledBatch(
            sendOrders.map((v) => v.event),
            chainsCfg[network].chainId,
            sendOrders.map((v) => v.transactionHash),
            sendOrders.map((v) => v.logIndex),
            { gasLimit, gasPrice }
          );
          logger.debug(
            `pending transaction(${tx.hash}),nonce(${
              tx.nonce
            }),gasLimit(${gasLimit.toString()},gasPrice(${ethers.utils.formatUnits(gasPrice, 'gwei')}gewi)`
          );
          asyncQueue.push({ tx, pendingOrders: [...sendOrders] });
        } catch (err) {
          const error = err as any;
          if (error.reason)
            logger.error(
              `sendToChain seaportOrderFulfilledBatch tx:${error.transactionHash},reason:${error.reason},code:${error.code}`
            );
          else logger.error(`sendToChain seaportOrderFulfilledBatch err:${(err as Error).message}`);
        }
      }
    }
    //异步等待处理
    if (asyncQueue.length > 0 && (asyncQueue.length >= ASYNC_NUMBER || state.pendingsLength < SEND_BATCH_COUNT)) {
      const { totals, errors } = await waitAsyncTrans<EVENT_TYPE>(
        [...asyncQueue],
        logger,
        getProviderWithProxy(WEDID_RPC_URL, CommandLineArgs.proxy, true),
        WAIT_CONFIRMATION_INTERVAL
      );
      asyncQueue.splice(0);
      //清理本地存储
      for (const evt of totals) {
        if (errors.findIndex((v) => evt.transactionHash == v.transactionHash) < 0)
          await state.del(getStateKey(evt.transactionHash, evt.logIndex));
      }
      state.revertPop(); //未被del的数据应该回滚，下次循环继续处理
    }
  }
  logger.info(`end sendToChain: pendings has ${state.pendingsLength}`);
};
const main = async (network: string) => {
  let timeoutHandler;
  const state = new State(network, STATE_FILE, { last: seaportCfg[network].DeployAfterNumber });
  await state.refresh();
  const provider = getProviderWithProxy(RPC_URL, CommandLineArgs.proxy);
  let latest = await provider.getBlockNumber();
  console.warn(CommandLineArgs);
  logger.info(
    `main starting:network(${network}),latest(${latest}),last(${state.last}),pendings(${state.pendingsLength}).`
  );
  const procLoop = async () => {
    try {
      const { toBlock, logs } = await fetchEventsByContract(
        new ethers.Contract(seaportCfg[network].Seaport, abiSeaport, provider),
        'OrderFulfilled',
        logger,
        BLOCK_BATCH_COUNT,
        latest,
        state.last
      );
      if (logs.length > 0 || state.pendingsLength > 0) {
        await sendToChain(
          network,
          state,
          logs.map((v) => ({
            block: v.log.blockNumber,
            transactionHash: v.log.transactionHash,
            logIndex: v.log.logIndex,
            event: {
              orderHash: v.desc.args.orderHash,
              offerer: v.desc.args.offerer,
              zone: v.desc.args.zone,
              recipient: v.desc.args.recipient,
              offer: v.desc.args.offer,
              consideration: v.desc.args.consideration,
            },
          }))
        );
      }
      await state.setLast(toBlock + 1);
      if (toBlock >= latest) {
        logger.warn(
          `procLoop:Out of range,toBlock(${toBlock}),latest(${latest}),sleep(${RELAX_INTERVAL - COMPACT_INTERVAL})`
        );
        await Sleep(RELAX_INTERVAL - COMPACT_INTERVAL);
        latest = await provider.getBlockNumber();
      }
    } catch (err) {
      logger.error(`procLoop err:${(err as Error).message},${(err as Error).stack}`);
    } finally {
      timeoutHandler = setTimeout(() => void procLoop(), COMPACT_INTERVAL);
    }
  };
  timeoutHandler = setTimeout(() => void procLoop(), 0);
};
void main(CHAIN_NAME);
