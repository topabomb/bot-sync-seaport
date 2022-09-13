import { ethers, logger } from 'ethers';
import { Logger } from 'log4js';
import { openSync, writeSync, readFileSync, access, constants, closeSync } from 'fs';
import { Level } from 'level';
const providerCache = {} as Record<string, ethers.providers.JsonRpcProvider>;
const Get_ProviderWithProxy = (rpc: string, proxy?: string) => {
  proxy && console.log(`❌ethers v5暂未支持代理，proxy选项暂时无效，当前proxy(${proxy})`);
  providerCache[rpc] ||= new ethers.providers.JsonRpcProvider(rpc);
  return providerCache[rpc];
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
interface STATE_PARTIAL_DATA {
  last: number;
  pendings?: Record<string, any>;
}
let leveldb = undefined as { state: Level; pendings: Level } | undefined;
const putPedingToPartialState = async (partial: string, path: string, key: string, value: any) => {
  if (!leveldb) loadPartialState(partial, path);
  await leveldb?.pendings.put(key, value);
};
const savePartialState = async (partial: string, path: string, data: STATE_PARTIAL_DATA) => {
  if (!leveldb) loadPartialState(partial, path);
  leveldb?.state.put('last', data.last.toString());
  await leveldb?.pendings.clear();
  if (data.pendings) {
    await leveldb?.pendings.batch(
      Object.keys(data.pendings).map((key) => {
        const value = data.pendings![key];
        return {
          type: 'put',
          key,
          value,
        };
      })
    );
  }
  /*
  const state = await loadPartialState(partial, path, {});
  state[partial] = data;
  const file = openSync(path, 'w+');
  writeSync(file, JSON.stringify(state));
  closeSync(file);
  */
};
const loadPartialState = async (
  partial: string,
  path: string,
  defaultValue?: STATE_PARTIAL_DATA
): Promise<Record<string, STATE_PARTIAL_DATA>> => {
  const state = {} as Record<string, STATE_PARTIAL_DATA>;
  if (!leveldb) {
    leveldb = {
      state: new Level(`${path}/${partial}/state`),
      pendings: new Level(`${path}/${partial}/pendings`, { valueEncoding: 'json' }),
    };
    state[partial] = defaultValue ? defaultValue : { last: 0 };
  }

  try {
    state[partial].last = Number(await leveldb.state.get('last'));
  } catch {
    console.warn('loadPartialState get(last) is LEVEL_NOT_FOUND.');
  }
  state[partial].pendings ||= {};
  for await (const [key, value] of leveldb.pendings.iterator()) {
    state[partial].pendings![key] = value;
  }
  return state;
  /*
  return new Promise((resolve, reject) => {
    access(path, constants.F_OK, (err) => {
      if (!err) {
        const file = openSync(path, 'r');
        const state = JSON.parse(readFileSync(file, { encoding: 'utf-8' })) as Record<string, STATE_PARTIAL_DATA>;
        closeSync(file);
        resolve(state);
      } else {
        const result = {} as Record<string, STATE_PARTIAL_DATA>;
        result[partial] = defaultValue;
        resolve(result);
      }
    });
  });*/
};
export {
  Get_ProviderWithProxy,
  fetchEventsByContract,
  STATE_PARTIAL_DATA,
  savePartialState,
  loadPartialState,
  putPedingToPartialState,
};
