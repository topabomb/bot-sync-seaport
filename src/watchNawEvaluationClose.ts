import { readFileSync } from 'fs';
import * as json5 from 'json5';
import { ethers } from 'ethers';
import fetch from 'node-fetch';
import cliProgress from 'cli-progress';
import * as dotenv from 'dotenv';
dotenv.config();
import { configure, getLogger } from 'log4js';
configure(`${__dirname}/constants/log4js_main.json`);
const logger = getLogger();
import { getProviderWithProxy, fetchEventsByContract, waitAsyncTrans, RpcServerException, Sleep } from './utils';
import { State, STATE_PARTIAL_BASE } from './state';

import abiNawarat from './abis/Nawarat.json';
import { program } from 'commander'; //https://github.com/tj/commander.js/blob/master/Readme_zh-CN.md
program
  .requiredOption('-c,--config <文件路径>', 'JSON配置文件', './configures/watchNawEvaluationClose.json')
  .option('-c,--contract <合约地址>', '被监控的合约地址', '0x74e52807A6a9a8928133cE2E58d83EBbd51A811B')
  .option('-d,--decrypt <解密接口URL>', '解密接口', 'https://test-app.nawarat.io/api')
  .option('-m,--mnemonic <助记词>', '替代.env中的助记词')
  .option('-pri,--prikey <私钥>', '优先使用的私钥')
  .option('-p,--proxy <服务器地址>', '使用代理服务器')
  .option('-b,--block <强制起始区块>', '使用指定区块进行启动');
const CommandLineArgs = program.parse().opts();
const CONFIG = json5.parse(readFileSync(CommandLineArgs.config, 'utf-8'));
const CHAIN_NAME = CONFIG.args.CHAIN_NAME ? CONFIG.args.CHAIN_NAME : 'goerli';
const STATE_FILE = CONFIG.args.STATE_FILE ? CONFIG.args.STATE_FILE : './.state';
const JSON_RPC = CONFIG.args.JSON_RPC
  ? CONFIG.args.JSON_RPC
  : 'https://eth-goerli.g.alchemy.com/v2/xDggsLMWWeET5OwHaGpLrJ184Y6NOY7c';
const DeployAfterNumber = CONFIG.args.DeployAfterNumber ? CONFIG.args.DeployAfterNumber : 0;
const BLOCK_BATCH_COUNT = CONFIG.args.BLOCK_BATCH_COUNT ? Number(CONFIG.args.BLOCK_BATCH_COUNT) : 256;
const COMPACT_INTERVAL = CONFIG.args.COMPACT_INTERVAL ? Number(CONFIG.args.COMPACT_INTERVAL) : 1000 * 0.2;
const RELAX_INTERVAL = CONFIG.args.RELAX_INTERVAL ? Number(CONFIG.args.RELAX_INTERVAL) : 1000 * 30;
const WAIT_CONFIRMATION_INTERVAL = CONFIG.args.WAIT_CONFIRMATION_INTERVAL
  ? Number(CONFIG.args.WAIT_CONFIRMATION_INTERVAL)
  : 30 * 1000;
//如下是可用命令行参数替换的配置
const NAW_CONTRACT = CommandLineArgs.contract ? CommandLineArgs.contract : CONFIG.NAW_CONTRACT;
const DECRYPT_URL = CommandLineArgs.decrypt ? CommandLineArgs.decrypt : CONFIG.DECRYPT_URL;
const MNEMONIC: string = CommandLineArgs.mnemonic ? CommandLineArgs.mnemonic : process.env.MNEMONIC;
const PRIKEY: string = CommandLineArgs.prikey ? CommandLineArgs.prikey : process.env.PRIKEY;
console.warn(CommandLineArgs, CONFIG);

interface EVENT_TYPE {
  block: number;
  transactionHash: string;
  logIndex: number;
  event: any;
}

const main = async (network: string) => {
  let timeoutHandler;
  const state = new State(network, STATE_FILE, { last: DeployAfterNumber });
  await state.refresh();
  if (CommandLineArgs.block) await state.setLast(Number(CommandLineArgs.block));
  let latest = await getProviderWithProxy(JSON_RPC, CommandLineArgs.proxy).getBlockNumber();

  logger.info(
    `main starting:network(${network}),latest(${latest}),last(${state.last}),pendings(${state.pendingsLength}).`
  );
  const procLoop = async () => {
    const provider = getProviderWithProxy(JSON_RPC, CommandLineArgs.proxy);
    try {
      const { toBlock, logs } = await fetchEventsByContract(
        new ethers.Contract(NAW_CONTRACT, abiNawarat.abi, provider),
        'evaluationClose',
        logger,
        BLOCK_BATCH_COUNT,
        latest,
        state.last
      );
      if (logs.length > 0 || state.pendingsLength > 0) {
        await processEvents(
          network,
          state,
          logs.map((v) => ({
            block: v.log.blockNumber,
            transactionHash: v.log.transactionHash,
            logIndex: v.log.logIndex,
            event: {
              inquirer: v.desc.args.inquirer_,
              chainid: v.desc.args.chainid_,
              nftAddress: v.desc.args.nftAddress_,
              tokenid: v.desc.args.tokenid_,
              nonce: v.desc.args.nonce_,
              cost: v.desc.args.cost_,
              totalVoters: v.desc.args.totalVoters_,
            },
          }))
        );
      }
      await state.setLast(toBlock + 1);
      if (state.last >= latest) {
        logger.warn(
          `procLoop:Out of range,last(${state.last}),latest(${latest}),sleep(${RELAX_INTERVAL - COMPACT_INTERVAL})`
        );
        await Sleep(RELAX_INTERVAL - COMPACT_INTERVAL);
        latest = await provider.getBlockNumber();
      }
    } catch (err) {
      if (err instanceof RpcServerException && (err as RpcServerException).needReboot()) {
        logger.error(`procLoop exit for err:${err}`);
        process.exit(0);
      }
      //logger.error(`procLoop err:${(err as Error).message},${(err as Error).stack}`);
      logger.error(`procLoop err:${(err as Error).message ? (err as Error).message : err}`);
    } finally {
      timeoutHandler = setTimeout(() => void procLoop(), COMPACT_INTERVAL);
    }
  };
  timeoutHandler = setTimeout(() => void procLoop(), 0);
};
const processEvents = async (network: string, state: State<STATE_PARTIAL_BASE>, events: EVENT_TYPE[]) => {
  for (const evt of events) {
    const { chainid, nftAddress, tokenid, nonce } = evt.event;
    const provider = getProviderWithProxy(JSON_RPC, CommandLineArgs.proxy);
    const wallet = PRIKEY
      ? new ethers.Wallet(PRIKEY, provider)
      : ethers.Wallet.fromMnemonic(MNEMONIC).connect(provider);
    const contract = new ethers.Contract(NAW_CONTRACT, abiNawarat.abi, provider).connect(wallet);
    const voters = await contract.votersAddresses(chainid, nftAddress, tokenid, nonce);
    const finalValue = await contract.finalEvaluation(chainid, nftAddress, tokenid, nonce);
    const lastNonce = await contract.getNonce(chainid, nftAddress, tokenid);
    let needBreak = false;
    const roundMsg = `chainid:${chainid.toString()},nftAddress:${nftAddress.toString()},tokenid:${tokenid.toString()},nonce:${nonce.toString()},finalValue:${finalValue.toString()},lastNonce:${lastNonce.toString()},voters:${
      voters.length
    }`;
    //if (finalValue.eq(0) && nonce.lt(lastNonce)) {
    if (finalValue.eq(0)) {
      logger.info(`process event for: block(${evt.block}),tran(${evt.transactionHash}),roundMsg(${roundMsg})`);
      const params = [] as { voter: string; appraisal: string }[];
      for (const voter of voters) {
        const { stake, appraisal, concealedAppraisal } = await contract.getVoterInformation(
          chainid,
          nftAddress,
          tokenid,
          nonce,
          voter
        );
        const urlGet = `${DECRYPT_URL}/decrypt?nft=${nftAddress}&chainid=${chainid}&tokenid=${tokenid}&nonce=${nonce}&value=${concealedAppraisal}`;
        const res = await fetch(urlGet, {
          //agent: getAgent(),
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.res) {
            const text = data.value.hex;
            params.push({ voter, appraisal: text });
          } else {
            logger.error(`fetch url(${urlGet} !res,data(${json5.stringify(data)}). status(${res.status}))`);
            //throw `fetch url(${urlGet} !res,data(${json5.stringify(data)}). status(${res.status}))`;
            await fallbackNonce(provider, contract, chainid, nftAddress, tokenid, nonce);
            needBreak = true; //解密不了,调用了callback，跳出第一层无需继续解密剩余的voter，并跳过后续的结算交易
            break;
          }
        } else {
          logger.error(`fetch url(${urlGet} error. status(${res.status}))`);
          throw `fetch url(${urlGet} error. status(${res.status}))`;
        }
      }
      if (needBreak) {
        logger.warn(`needBreak--${roundMsg}`);
        continue;
      }
      let gasLimit;
      logger.warn(
        `endEvaluationNonce calling as chainid:${chainid.toString()},nftAddress:${nftAddress.toString()},tokenid:${tokenid.toString()},nonce:${nonce.toString()}`
      );
      try {
        gasLimit = await contract.estimateGas.endEvaluationNonce(chainid, nftAddress, tokenid, nonce, params);
      } catch (err) {
        const error = err as any;
        let msg = '';
        if (error.reason && error.error) msg = `reason:${error.reason},data:${error.error.data}`;
        else msg = `err:${err as Error}`;
        logger.error(`endEvaluationNonce  estimateGas Error ${msg},roundMsg: ${roundMsg},parms:`, params);
        throw Error(msg);
      }
      if (gasLimit) {
        gasLimit = Math.round(Number(gasLimit) * 1.1);
        let gasPrice = await provider.getGasPrice();
        gasPrice = gasPrice.mul(110).div(100);
        try {
          const tx = await contract.endEvaluationNonce(chainid, nftAddress, tokenid, nonce, params, {
            gasLimit,
            gasPrice,
          });
          logger.debug(
            `pending transaction(${tx.hash}),nonce(${
              tx.nonce
            }),gasLimit(${gasLimit.toString()},gasPrice(${ethers.utils.formatUnits(gasPrice, 'gwei')}gewi)`
          );
          const receipt = await provider.waitForTransaction(tx.hash, 1, WAIT_CONFIRMATION_INTERVAL);
          logger.info(
            `complete transaction(${tx.hash}),block(${receipt.blockNumber}),confirmations (${
              receipt.confirmations
            }),gasUsed(${receipt.gasUsed}),effectiveGasPrice(${ethers.utils.formatUnits(
              receipt.effectiveGasPrice,
              'gwei'
            )}gewi)`
          );
        } catch (err) {
          const error = err as any;
          let msg = '';
          if (error.reason) msg = `tx:${error.transactionHash},reason:${error.reason},code:${error.code}`;
          else msg = `err:${(err as Error).message}`;
          logger.error(`endEvaluationNonce Error ${msg}`);
          throw Error(msg);
        }
      }
    } else {
      logger.debug(`break event for: block(${evt.block}),tran(${evt.transactionHash}),roundMsg(${roundMsg})`);
      continue;
    }
  }
};
const fallbackNonce = async (
  provider: ethers.providers.Provider,
  contract: ethers.Contract,
  chainId: ethers.BigNumber,
  nftAddress: string,
  tokenId: ethers.BigNumber,
  nonce: ethers.BigNumber
) => {
  const roundMsg = `chainid:${chainId.toString()},nftAddress:${nftAddress.toString()},tokenid:${tokenId.toString()},nonce:${nonce.toString()}`;
  let gasLimit;
  logger.warn(`fallbackNonce calling as chainid: ${roundMsg}`);
  try {
    gasLimit = await contract.estimateGas.fallbackNonce(chainId, nftAddress, tokenId, nonce);
  } catch (err) {
    const error = err as any;
    let msg = '';
    if (error.reason && error.error) msg = `reason:${error.reason},data:${error.error.data}`;
    else msg = `err:${err as Error}`;
    logger.error(`fallbackNonce  estimateGas Error ${msg},roundMsg: ${roundMsg}`);
    throw Error(msg);
  }
  if (gasLimit) {
    gasLimit = Math.round(Number(gasLimit) * 1.1);
    let gasPrice = await provider.getGasPrice();
    gasPrice = gasPrice.mul(150).div(100);
    try {
      const tx = await contract.fallbackNonce(chainId, nftAddress, tokenId, nonce, {
        gasLimit,
        gasPrice,
      });
      logger.debug(
        `pending transaction(${tx.hash}),nonce(${
          tx.nonce
        }),gasLimit(${gasLimit.toString()},gasPrice(${ethers.utils.formatUnits(gasPrice, 'gwei')}gewi)`
      );
      try {
        const receipt = await provider.waitForTransaction(tx.hash, 1, WAIT_CONFIRMATION_INTERVAL);
        logger.info(
          `complete transaction(${tx.hash}),block(${receipt.blockNumber}),confirmations (${
            receipt.confirmations
          }),gasUsed(${receipt.gasUsed}),effectiveGasPrice(${ethers.utils.formatUnits(
            receipt.effectiveGasPrice,
            'gwei'
          )}gewi)`
        );
      } catch (err) {
        logger.error(`continue!!! timeout for transaction(${tx.hash})`);
      }
    } catch (err) {
      const error = err as any;
      let msg = '';
      if (error.reason) msg = `tx:${error.transactionHash},reason:${error.reason},code:${error.code}`;
      else msg = `err:${(err as Error).message}`;
      logger.error(`fallbackNonce Error ${msg}`);
      throw Error(msg);
    }
  }
};
void main(CHAIN_NAME);
