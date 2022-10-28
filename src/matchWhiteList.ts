import * as json5 from 'json5';
import { parse } from 'csv-parse/sync';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { ethers } from 'ethers';
import cliProgress from 'cli-progress';
import { configure, getLogger } from 'log4js';
import log4js_main from './constants/log4js_main.json';
configure(log4js_main);
const logger = getLogger();
import { Level } from 'level';
import { program } from 'commander'; //https://github.com/tj/commander.js/blob/master/Readme_zh-CN.md
program
  .option('-f,--file <CSV File>', 'csv 文件')
  .option('-c,--columns', '使用columns模式加载csv', false)
  .option('-r,--rpc <RPC地址>', '替代内置RPC', 'https://bsc-mainnet.nodereal.io/v1/77f86ccf7d8a478684e42210d98a840f');

const CommandLineArgs = program.parse().opts();
console.log(CommandLineArgs);
const abi = [
  {
    inputs: [
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
    ],
    name: 'balanceOf',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];
const max_queue_size = 40;
const nft_address = '0x13d42A7f7ff691eD06bF3Ee47b07303389181adA';
const fileName = CommandLineArgs.file;
const columnMode = CommandLineArgs.columns;
const rpc = CommandLineArgs.rpc;
async function main() {
  if (!existsSync(fileName)) {
    logger.error(`未能找到指定的文件${fileName}`);
    return;
  }
  const kvDb_last = new Level('./.watch/last');
  const kvDb_state = new Level('./.watch/state');
  await kvDb_last.open();
  await kvDb_state.open();
  let last = 0;
  try {
    last = Number(await kvDb_last.get('last'));
  } catch {
    await kvDb_last.put('last', last.toString());
    logger.debug('init last.');
  }
  logger.warn(`last:${last},state length(${(await kvDb_state.keys().all()).length})`);

  const content = readFileSync(fileName);
  const records = parse(content, {
    columns: columnMode,
    skip_empty_lines: true,
  }) as string[][];
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const contract = new ethers.Contract(nft_address, abi, provider);
  const bar = new cliProgress.SingleBar({
    format: 'checking [{bar}] {percentage}% | {value}/{total} | ETA: {eta}s',
  });

  const proc = (queue: string[]) => {
    return new Promise((resolve, reject) => {
      let complete = 0;
      for (const addr of queue) {
        kvDb_state.get(addr, (err, val) => {
          if (err && err.message.startsWith('NotFound:')) {
            Sleep(10)
              .then(() => {
                contract
                  .balanceOf(addr)
                  .then((amount: number) => {
                    //logger.debug(`address(${addr}) amount(${amount})`);
                    void kvDb_state.put(addr, amount.toString());
                  })
                  .catch((e: Error) => {
                    reject(e);
                  })
                  .finally(() => {
                    complete++;
                  });
              })
              .catch(() => {});
          } else {
            complete++;
          }
        });
      }
      const wait = () => {
        if (complete == queue.length) {
          resolve(true);
        } else setTimeout(wait, 100);
      };
      wait();
    });
  };
  let progress = 0;
  bar.start(records.length - last, progress);
  let curr_queue = [] as string[];
  for (let i = last; i < records.length; i++) {
    const r = records[i];
    const rawAddr = ethers.utils.getAddress(r[0]);
    if (ethers.utils.isAddress(rawAddr)) {
      curr_queue.push(rawAddr);
      if (curr_queue.length >= max_queue_size || i == records.length - 1) {
        await proc(curr_queue);
        await kvDb_last.put('last', i.toString());
        progress += curr_queue.length;
        curr_queue = [];
        bar.update(progress);
      }
    } else {
      logger.error(`address(${rawAddr}) is error`);
    }
  }
  bar.stop();
  const obj_json = [] as string[];
  const zero_json = [] as { address: string; amount: string }[];
  for await (const key of kvDb_state.keys()) {
    const amount = await kvDb_state.get(key);
    if (Number(amount) <= 0) {
      //logger.warn(`key(${key}),value(${amount}) is zero.`);
      zero_json.push({ address: key, amount: amount });
    } else obj_json.push(key);
  }
  logger.warn(`zero count(${records.length - obj_json.length})`);
  writeFileSync('output_whitelist.json', json5.stringify(obj_json));
  writeFileSync('output_zerolist.json', json5.stringify(zero_json));
}
const Sleep = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
void main();
