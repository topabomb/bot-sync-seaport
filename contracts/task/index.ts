import { task } from 'hardhat/config';

/*
import flow_sell from './flow_sell';
import flow_buy from './flow_buy';
task('flow_sell').setAction(flow_sell);
task('flow_buy').setAction(flow_buy).addOptionalParam('nft', 'nft address').addOptionalParam('id', 'token id');
*/
import clean from './clean';
import addExecutor from './addExecutor';
task('cleanData').setAction(clean);
task('addExecutor').setAction(addExecutor).addParam('executor', 'executor address.');
