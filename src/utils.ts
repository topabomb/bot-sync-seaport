import { ethers } from 'ethers';
import { Logger } from 'log4js';
const providerCache = {} as Record<string, { timestamp: number; instance: ethers.providers.Provider }>;
const getProviderWithProxy = (rpc: string, proxy?: string, newInstance?: boolean): ethers.providers.Provider => {
  proxy && console.log(`❌ethers v5暂未支持代理，proxy选项暂时无效，当前proxy(${proxy})`);
  let result;
  if (newInstance) result = new ethers.providers.JsonRpcProvider(rpc);
  else {
    //仅在60秒内复用连接
    if (!providerCache[rpc] || providerCache[rpc].timestamp < Date.now() - 60000) {
      console.log(`rpc(${rpc})更换为新的对象实例.`);
      providerCache[rpc] = { timestamp: Date.now(), instance: new ethers.providers.JsonRpcProvider(rpc) };
    }
    result = providerCache[rpc].instance;
  }
  return result;
};
class RpcServerException extends Error {
  protected code: number;
  protected detail: string;
  constructor(_detail = 'unknow', _code = 500) {
    //特殊约定，505需要重启
    super(`RpcServerException:code(${_code}),detail(${_detail})`);
    this.code = _code;
    this.detail = _detail;
  }
  public getCode = () => this.code;
  public needReboot = () => this.code == 505;
}
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
  if (toBlock > latest) toBlock = latest;
  if (block > toBlock) block = toBlock;
  logger.debug(`fetchEvents(${eventName}) starting at [${block}-${toBlock}]`);
  const filter = {
    address: instance.address, //不传递address可以查询所有合约的数据
    topics: [topicFulfilled],
    fromBlock: block,
    toBlock: toBlock,
  };
  const logs: { log: ethers.providers.Log; desc: ethers.utils.LogDescription }[] = [];
  try {
    const hitLogs = await instance.provider.getLogs(filter);
    logger.info(`fetchEvents(${eventName}) at [${block}-${toBlock}],hit logs(${hitLogs.length})`);
    hitLogs?.forEach((log) => {
      //const evt = seaport.interface.decodeEventLog('OrderFulfilled', log.data, log.topics);
      const desc = instance.interface.parseLog(log);
      if (desc.name == eventName) logs.push({ log, desc });
    });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('One of the blocks specified in filter')) {
      throw new RpcServerException('服务端异常：One of the blocks specified in filter，可以尝试重连rpc端点', 505);
    } else throw err;
  }
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
export { getProviderWithProxy, fetchEventsByContract, RpcServerException, waitAsyncTrans, Sleep };
