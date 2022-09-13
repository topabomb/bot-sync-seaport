import { ethers, logger } from 'ethers';
import { Logger } from 'log4js';
import { openSync, writeSync, readFileSync, access, constants, closeSync } from 'fs';
import { Level } from 'level';
const providerCache = {} as Record<string, ethers.providers.JsonRpcProvider>;
const Get_ProviderWithProxy = (rpc: string, proxy?: string, newInstance?: boolean) => {
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
  logger.debug(`fetchEvents(${eventName}) starting at [${block}-${toBlock}]`);
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
export { Get_ProviderWithProxy, fetchEventsByContract };
