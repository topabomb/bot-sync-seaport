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

const BLOCK_BATCH_COUNT = 128;
const TIME_INTERVAL = 1000 * 0.2;
const STATE_FILE = './state.json';
const SEND_BATCH_COUNT = 128;
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
const fetchEvents = async (network: string, block: number): Promise<{ toBlock: number; events: EVENT_TYPE[] }> => {
  //block = 14950918; //用于测试block:14950918
  logger.debug(`fetchEvents(${network}) starting by ${block}`);
  const provider = new ethers.providers.JsonRpcProvider(chainsCfg[network].rpcUrls[0]);
  const seaport = new ethers.Contract(seaportCfg[network].Seaport, abiSeaport, provider);
  const topicFulfilled = seaport.interface.getEventTopic('OrderFulfilled');
  const toBlock = block + BLOCK_BATCH_COUNT;
  const filter = {
    address: seaport.address, //不传递address可以查询所有合约的数据
    topics: [topicFulfilled],
    fromBlock: block,
    toBlock: toBlock,
  };
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

const sendToChain = async (network: string, state: STATE_CHAIN_TYPE, events: EVENT_TYPE[]) => {
  const provider = new ethers.providers.JsonRpcProvider(chainsCfg['wedid_dev'].rpcUrls[0]);
  const wallet = ethers.Wallet.fromMnemonic(process.env.MNEMONIC as string).connect(provider);
  const monitor = new ethers.Contract(abiMonitor.address, abiMonitor.abi, provider).connect(wallet);
  logger.warn(
    `sendToChain:address(${wallet.address}),balance(${await ethers.utils.formatEther(
      await wallet.getBalance()
    )},tranCount(${await wallet.getTransactionCount()})`
  );
  //先保存本次尚未处理的交易
  if (!state.pendings) state.pendings = {};
  for (const evt of events) {
    state.pendings[evt.transactionHash] = { ...evt };
  }
  saveState(network, state);
  //添加到队列
  for (const evt of events) {
    QUEUE_TRANS.push({ ...evt });
  }
  logger.warn(`sendToChain:QUEUE_TRANS has ${QUEUE_TRANS.length}`);
  const asyncQueue = [] as { tx: ethers.providers.TransactionResponse; pendingOrders: EVENT_TYPE[] }[];
  //处理队列
  while (QUEUE_TRANS.length > SEND_BATCH_COUNT) {
    const orders = [];
    const sendOrders = [];
    do {
      const evt = QUEUE_TRANS.pop();
      if (evt) {
        orders.push(evt);
        const existent = await monitor.containsTransaction(chainsCfg[network].chainId, evt.transactionHash);
        if (!existent) sendOrders.push(evt);
        /*
      //通过estimateGas决定执行哪一些
      let existent = false;
      try {
        await monitor.estimateGas.seaportOrderFulfilled(
          evt.event,
          chainsCfg[network].chainId,
          evt.transactionHash,
          evt.logIndex
        );
      } catch (err) {
        const error = err as any;
        existent = error.error ? (error.error as Error).message.endsWith('tran existent') : false;
        if (!existent)
          if (error.reason && error.error)
            logger.error(
              `sendToChain seaportOrderFulfilled estimateGas reason:${error.reason},message:${error.error.message},data:${error.error.data}`
            );
          else logger.error(`sendToChain seaportOrderFulfilled estimateGas err:${err as Error}`);
      }
      if (!existent) sendOrders.push(evt);
      */
      }
    } while (sendOrders.length < SEND_BATCH_COUNT && QUEUE_TRANS.length > 0);

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
          //异步等待处理
          if (asyncQueue.length >= 4) {
            let complete = 0;
            let errors = [] as EVENT_TYPE[];
            while (asyncQueue.length > 0) {
              const item = asyncQueue.pop();
              if (!item) break;
              try {
                const receipt = await item.tx.wait(1);
                logger.info(
                  `complete transaction(${tx.hash}),block(${receipt.blockNumber}),confirmations (${
                    receipt.confirmations
                  }),gasUsed(${receipt.gasUsed}),effectiveGasPrice(${ethers.utils.formatUnits(
                    receipt.effectiveGasPrice,
                    'gwei'
                  )}gewi)`
                );
              } catch (err) {
                errors = errors.concat(item.pendingOrders);
                const error = err as any;
                if (error.receipt)
                  logger.error(
                    `sendToChain seaportOrderFulfilledBatch wait tx:${error.transactionHash},blockNumber:${error.receipt.blockNumber},reason:${error.reason}`
                  );
                else logger.error(`sendToChain seaportOrderFulfilledBatch wait err:${(err as Error).message}`);
              } finally {
                complete++;
              }
            }
            if (complete == asyncQueue.length) {
              //清理本地存储
              for (const evt of orders) {
                if (errors.findIndex((v) => evt.transactionHash == v.transactionHash) < 0)
                  delete state.pendings[evt.transactionHash];
              }
              saveState(network, state);
            }
          }
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
  }
  /*
  //逐一处理
  for (const evt of events) {
    let gasLimit;
    let existent = false;
    try {
      gasLimit = await monitor.estimateGas.seaportOrderFulfilled(
        evt.event,
        chainsCfg[network].chainId,
        evt.transactionHash
      );
    } catch (err) {
      const error = err as any;
      existent = error.error ? (error.error as Error).message.endsWith('tran existent') : false;
      if (!existent)
        if (error.reason && error.error)
          logger.error(`sendToChain estimateGas reason:${error.reason},data:${error.error.data}`);
        else logger.error(`sendToChain estimateGas err:${err as Error}`);
    }
    if (gasLimit && !existent) {
      gasLimit = Math.round(Number(gasLimit) / 8); //frontier中针对estimateGas似乎有个倍数处理，暂时除以经验值，参考地址https://github.com/paritytech/frontier/issues/76
      const gasPrice = await provider.getGasPrice();
      try {
        const tx = await monitor.seaportOrderFulfilled(evt.event, chainsCfg[network].chainId, evt.transactionHash, {
          gasLimit,
          gasPrice,
        });
        logger.debug(
          `pending transaction(${tx.hash}),nonce(${
            tx.nonce
          }),gasLimit(${gasLimit.toString()},gasPrice(${ethers.utils.formatUnits(gasPrice, 'gwei')}gewi)`
        );
        delete state.pendings[evt.transactionHash];
        saveState(network, state);
      } catch (err) {
        const error = err as Error;
        if (!error.message.includes('nonce has already been used')) {
          logger.error(`sendToChain execute err:${err as Error}`);
        } else logger.error(`sendToChain execute nonce has already been used`);
      }
    } else if (existent) {
      logger.warn(`sendToChain hash(${evt.transactionHash}) existent`);
      delete state.pendings[evt.transactionHash];
      saveState(network, state);
    }
  }
  */
};
const QUEUE_TRANS = [] as EVENT_TYPE[];
const main = async (network: string) => {
  let timeoutHandler;
  const state = (await loadState(network))[network];
  logger.debug(`state:${network}`);
  if (state.pendings) {
    for (const key of Object.keys(state.pendings)) {
      const evt = state.pendings[key];
      QUEUE_TRANS.push({ ...evt });
    }
  }
  const procLoop = async () => {
    try {
      const { toBlock, events } = await fetchEvents(network, state.last);
      if (events.length > 0 || QUEUE_TRANS.length > 0) {
        await sendToChain(network, state, events);
      }
      state.last = toBlock + 1;
      saveState(network, state);
    } catch (err) {
      logger.error(`procLoop err:${(err as Error).message}`);
    } finally {
      timeoutHandler = setTimeout(procLoop, TIME_INTERVAL);
    }
  };
  timeoutHandler = setTimeout(procLoop, 0);
};

void main('ethereum');
