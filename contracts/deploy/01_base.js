"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const func = function (hre) {
    return __awaiter(this, void 0, void 0, function* () {
        const { deployments, getNamedAccounts, ethers } = hre;
        const { deploy } = deployments;
        const { deployer } = yield getNamedAccounts();
        const monitor = yield deploy('NftTradeMonitor', {
            from: deployer,
            args: [],
            log: true,
            proxy: {
                proxyContract: 'OpenZeppelinTransparentProxy',
                owner: deployer,
                execute: { init: { methodName: 'initialize', args: [] } },
            },
        });
        console.log(`🟢[${hre.network.name}] monitor address: ${monitor.address}`);
    });
};
exports.default = func;
