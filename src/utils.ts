import { ethers, logger } from 'ethers';
import { Logger } from 'log4js';
import { openSync, writeSync, readFileSync, access, constants, closeSync } from 'fs';
import { Level } from 'level';
const providerCache = {} as Record<string, ethers.providers.Provider>;
const getProviderWithProxy = (rpc: string, proxy?: string, newInstance?: boolean) => {
  proxy && console.log(`❌ethers v5暂未支持代理，proxy选项暂时无效，当前proxy(${proxy})`);
  let result;
  if (newInstance) result = new ethers.providers.JsonRpcProvider(rpc);
  else {
    providerCache[rpc] ||= new ethers.providers.JsonRpcProvider(rpc);
    result = providerCache[rpc];
  }
  return result;
};
const fetchEventsByContract = async (
  instance: ethers.Contract,
  eventName: string,
  logger: Logger,
  batch_count: number,
  latest: number,
  block: number
): Promise<{ toBlock: number; logs: { log: ethers.providers.Log; desc: ethers.utils.LogDescription }[] }> => {
  const topicFulfilled = instance.interface.getEventTopic(eventName);
  let toBlock = block + batch_count;
  if (toBlock > latest) {
    toBlock = latest;
  }
  const filter = {
    address: instance.address, //不传递address可以查询所有合约的数据
    topics: [topicFulfilled],
    fromBlock: block,
    toBlock: toBlock,
  };
  //logger.debug(`fetchEvents(${eventName}) starting at [${block}-${toBlock}]`);
  const hitLogs = await instance.provider.getLogs(filter);
  logger.info(`fetchEvents(${eventName}) at [${block}-${toBlock}],hit logs(${hitLogs.length})`);
  const logs: { log: ethers.providers.Log; desc: ethers.utils.LogDescription }[] = [];
  hitLogs.forEach((log) => {
    //const evt = seaport.interface.decodeEventLog('OrderFulfilled', log.data, log.topics);
    const desc = instance.interface.parseLog(log);
    if (desc.name == eventName) logs.push({ log, desc });
  });
  return { toBlock, logs };
};
const waitAsyncTrans = async <T>(
  queue: { tx: ethers.providers.TransactionResponse; pendingOrders: T[] }[],
  logger: Logger,
  provider: ethers.providers.Provider,
  wait_confirmation_interval: number
): Promise<{ totals: T[]; errors: T[] }> => {
  logger.debug(
    `waitAsyncTrans:queue(${queue.length}),timeout(${wait_confirmation_interval}),trans(${queue
      .map((v) => v.tx.hash)
      .join(',')})`
  );
  return new Promise((resolve, reason) => {
    let complete = 0;
    let errors = [] as T[];
    let totals = [] as T[];
    for (const item of queue) {
      totals = totals.concat(item.pendingOrders);
      provider
        .waitForTransaction(item.tx.hash, 1, wait_confirmation_interval)
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
const Sleep = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
export { getProviderWithProxy, fetchEventsByContract, waitAsyncTrans, Sleep };
