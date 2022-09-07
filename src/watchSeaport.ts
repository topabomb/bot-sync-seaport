import 'dotenv/config';
import { configure, getLogger } from 'log4js';
import log4js_main from './settings/log4js_main.json';
//configure(`${__dirname}/settings/log4js_main.json`);
configure(log4js_main);
const logger = getLogger();
import { ethers } from 'ethers';
import cliProgress from 'cli-progress';

import jsonChains from './settings/chains.json';
const chainsCfg = jsonChains as Record<string, { rpcUrls: string[]; chainId: string }>;
import jsonSeaport from './settings/seaport.json';
const seaportCfg = jsonSeaport as Record<string, { Seaport: string; DeployAfterNumber: number }>;
import abiSeaport from './abis/seaport.json';
import abiMonitor from './abis/NftTradeMonitor.json';

import { openSync, writeSync, readFileSync, access, constants, closeSync } from 'fs';
import * as json5 from 'json5';
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
const STATE_FILE = CONFIG.args.STATE_FILE ? CONFIG.args.STATE_FILE : './state.json';
const SEND_BATCH_COUNT = CONFIG.args.SEND_BATCH_COUNT ? Number(CONFIG.args.SEND_BATCH_COUNT) : 96;
const ASYNC_NUMBER = CONFIG.args.ASYNC_NUMBER ? Number(CONFIG.args.ASYNC_NUMBER) : 8;
const WAIT_CONFIRMATION_INTERVAL = CONFIG.args.WAIT_CONFIRMATION_INTERVAL
  ? Number(CONFIG.args.WAIT_CONFIRMATION_INTERVAL)
  : 20 * 1000;
//如下是可用命令行参数替换的配置
const MNEMONIC: string = CommandLineArgs.mnemonic ? CommandLineArgs.mnemonic : process.env.MNEMONIC;
const RPC_URL = CommandLineArgs.rpc ? CommandLineArgs.rpc : chainsCfg[CHAIN_NAME].rpcUrls[0];
const Get_ProviderWithProxy = (rpc: string) => {
  const proxy = CommandLineArgs.proxy ? CommandLineArgs.proxy : undefined;
  proxy && console.log(`❌ethers v5暂未支持代理，proxy选项暂时无效，当前proxy(${proxy})`);
  return new ethers.providers.JsonRpcProvider(rpc);
};
interface STATE_CHAIN_TYPE {
  last: number;
  pendings?: Record<string, EVENT_TYPE>;
}
interface EVENT_TYPE {
  block: number;
  transactionHash: string;
  logIndex: number;
  event: any;
}
const saveState = async (network: string, data: STATE_CHAIN_TYPE) => {
  const state = await loadState(network);
  state[network] = data;
  const file = openSync(STATE_FILE, 'w+');
  writeSync(file, JSON.stringify(state));
  closeSync(file);
};
const loadState = (network: string): Promise<Record<string, STATE_CHAIN_TYPE>> => {
  return new Promise((resolve, reject) => {
    access(STATE_FILE, constants.F_OK, (err) => {
      if (!err) {
        const file = openSync(STATE_FILE, 'r');
        const state = JSON.parse(readFileSync(file, { encoding: 'utf-8' })) as Record<string, STATE_CHAIN_TYPE>;
        closeSync(file);
        resolve(state);
      } else {
        const result = {} as Record<string, STATE_CHAIN_TYPE>;
        result[network] = { last: seaportCfg[network].DeployAfterNumber };
        resolve(result);
      }
    });
  });
};
const fetchEvents = async (
  network: string,
  latest: number,
  block: number
): Promise<{ toBlock: number; events: EVENT_TYPE[] }> => {
  //block = 14950918; //用于测试block:14950918
  const provider = Get_ProviderWithProxy(chainsCfg[network].rpcUrls[0]);
  const seaport = new ethers.Contract(seaportCfg[network].Seaport, abiSeaport, provider);
  const topicFulfilled = seaport.interface.getEventTopic('OrderFulfilled');
  let toBlock = block + BLOCK_BATCH_COUNT;
  if (toBlock > latest) {
    toBlock = latest;
  }
  const filter = {
    address: seaport.address, //不传递address可以查询所有合约的数据
    topics: [topicFulfilled],
    fromBlock: block,
    toBlock: toBlock,
  };
  logger.debug(`fetchEvents(${network}) starting at [${block}-${toBlock}]`);
  const hitLogs = await provider.getLogs(filter);
  logger.debug(`fetchEvents(${network}) at [${block}-${toBlock}],hit logs(${hitLogs.length})`);
  const events: EVENT_TYPE[] = [];
  hitLogs.forEach((log) => {
    //const evt = seaport.interface.decodeEventLog('OrderFulfilled', log.data, log.topics);
    const desc = seaport.interface.parseLog(log);
    if (desc.name == 'OrderFulfilled') {
      const evt = {
        block: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        event: {
          orderHash: desc.args.orderHash,
          offerer: desc.args.offerer,
          zone: desc.args.zone,
          recipient: desc.args.recipient,
          offer: desc.args.offer,
          consideration: desc.args.consideration,
        },
      };
      events.push(evt);
    }
  });

  return { toBlock, events };
};
const waitAsyncTrans = async (
  queue: { tx: ethers.providers.TransactionResponse; pendingOrders: EVENT_TYPE[] }[]
): Promise<{ totals: EVENT_TYPE[]; errors: EVENT_TYPE[] }> => {
  logger.debug(`waitAsyncTrans:queue(${queue.length})`);
  return new Promise((resolve, reason) => {
    const provider = Get_ProviderWithProxy(WEDID_RPC_URL);
    let complete = 0;
    let errors = [] as EVENT_TYPE[];
    let totals = [] as EVENT_TYPE[];
    for (const item of queue) {
      totals = totals.concat(item.pendingOrders);
      //logger.debug(`waitAsyncTrans:waiting from (${item.tx.hash})`);
      provider
        .waitForTransaction(item.tx.hash, 1, WAIT_CONFIRMATION_INTERVAL)
        .then((receipt) => {
          logger.info(
            `complete transaction(${item.tx.hash}),block(${receipt.blockNumber}),confirmations (${
              receipt.confirmations
            }),gasUsed(${receipt.gasUsed}),effectiveGasPrice(${ethers.utils.formatUnits(
              receipt.effectiveGasPrice,
              'gwei'
            )}gewi)`
          );
        })
        .catch((err) => {
          errors = errors.concat(item.pendingOrders);
          const error = err as any;
          if (error.receipt)
            logger.error(
              `sendToChain seaportOrderFulfilledBatch wait tx:${error.transactionHash},blockNumber:${error.receipt.blockNumber},reason:${error.reason}`
            );
          else logger.error(`sendToChain seaportOrderFulfilledBatch wait err:${(err as Error).message}`);
        })
        .finally(() => {
          complete++;
          if (complete == queue.length) resolve({ totals, errors });
        });
    }
  });
};
const sendToChain = async (network: string, state: STATE_CHAIN_TYPE, events: EVENT_TYPE[]) => {
  const provider = Get_ProviderWithProxy(WEDID_RPC_URL);
  const wallet = ethers.Wallet.fromMnemonic(MNEMONIC).connect(provider);
  const monitor = new ethers.Contract(abiMonitor.address, abiMonitor.abi, provider).connect(wallet);
  logger.info(
    `sendToChain:address(${wallet.address}),balance(${await ethers.utils.formatEther(
      await wallet.getBalance()
    )},tranCount(${await wallet.getTransactionCount()})`
  );
  //先保存本次尚未处理的交易
  if (!state.pendings) state.pendings = {};
  for (const evt of events) {
    state.pendings[evt.transactionHash] = { ...evt };
  }
  if (events.length > 0) saveState(network, state);
  //添加到队列
  for (const evt of events) {
    QUEUE_TRANS.push({ ...evt });
  }
  logger.warn(`sendToChain:QUEUE_TRANS has ${QUEUE_TRANS.length}`);
  const asyncQueue = [] as { tx: ethers.providers.TransactionResponse; pendingOrders: EVENT_TYPE[] }[];
  //处理队列
  while (QUEUE_TRANS.length >= SEND_BATCH_COUNT) {
    const orders = [];
    const sendOrders = [];
    const bar = new cliProgress.SingleBar({
      format: 'checking containsTransactions [{bar}] {percentage}% | {value}/{total} | ETA: {eta}s',
    });
    bar.start(QUEUE_TRANS.length, 0);
    let progress = 0;
    do {
      const evt = QUEUE_TRANS.pop();
      if (evt) {
        orders.push(evt);
        const existent = await monitor.containsTransaction(chainsCfg[network].chainId, evt.transactionHash);
        if (!existent) sendOrders.push(evt);
        else delete state.pendings[evt.transactionHash];
        bar.update(++progress);
      }
    } while (sendOrders.length < SEND_BATCH_COUNT && QUEUE_TRANS.length > 0);
    bar.setTotal(progress);
    bar.stop();
    saveState(network, state);
    logger.warn(
      `sendToChain:orders(${orders.length}),sendOrders(${sendOrders.length}),QUEUE_TRANS(${QUEUE_TRANS.length})`
    );
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
            {
              gasLimit,
              gasPrice,
            }
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
    if (asyncQueue.length > 0 && (asyncQueue.length >= ASYNC_NUMBER || QUEUE_TRANS.length < SEND_BATCH_COUNT)) {
      const { totals, errors } = await waitAsyncTrans([...asyncQueue]);
      asyncQueue.splice(0);
      //清理本地存储
      for (const evt of totals) {
        if (errors.findIndex((v) => evt.transactionHash == v.transactionHash) < 0)
          delete state.pendings[evt.transactionHash];
      }
      saveState(network, state);
    }
  }
};
const QUEUE_TRANS = [] as EVENT_TYPE[];
const main = async (network: string) => {
  let timeoutHandler;
  const state = (await loadState(network))[network];
  if (state.pendings) {
    for (const key of Object.keys(state.pendings)) {
      const evt = state.pendings[key];
      QUEUE_TRANS.push({ ...evt });
    }
  }
  const provider = Get_ProviderWithProxy(RPC_URL);
  let latest = await provider.getBlockNumber();
  logger.info(`main starting:network:${network},latest(${latest}),QUEUE_TRANS(${QUEUE_TRANS.length}).`);
  const sleep = (ms: number) => {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  };
  const procLoop = async () => {
    try {
      const { toBlock, events } = await fetchEvents(network, latest, state.last);
      if (events.length > 0 || QUEUE_TRANS.length > 0) {
        await sendToChain(network, state, events);
      }
      state.last = toBlock;
      saveState(network, state);
      if (toBlock >= latest) {
        logger.warn(
          `procLoop:Out of range,toBlock(${toBlock}),latest(${latest}),sleep(${RELAX_INTERVAL - COMPACT_INTERVAL})`
        );
        await sleep(RELAX_INTERVAL - COMPACT_INTERVAL);
        latest = await provider.getBlockNumber();
      }
    } catch (err) {
      logger.error(`procLoop err:${(err as Error).message}`);
    } finally {
      timeoutHandler = setTimeout(procLoop, COMPACT_INTERVAL);
    }
  };
  timeoutHandler = setTimeout(procLoop, 0);
};
main(CHAIN_NAME);
