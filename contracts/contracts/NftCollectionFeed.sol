//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "./base/ExecutorBase.sol";
import "./interface/IMonitor.sol";
import "./interface/ICollectionOracle.sol";

contract NftCollectionFeed is ExecutorBase, ICollectionOracle {
    using EnumerableMap for EnumerableMap.UintToUintMap;

    IMonitor internal monitor;

    //从monitor中的contracts的index映射到rounds
    mapping(uint => mapping(uint => CollectionRoundData)) internal dataFeed; //结构为contracts.idx=>round=>CollectionRoundData
    EnumerableMap.UintToUintMap internal collectionRounds; //结构为contracts.idx=>current round

    function initialize(address monitorAddr) public initializer {
        __Ownable_init();
        monitor = IMonitor(monitorAddr);
    }

    function submitRoundData(
        uint chainId,
        address collection,
        ExchangePrice calldata data
    ) public override onlyExecutorOrOwner {
        uint idx = monitor.getNftContractIndex(chainId, collection);
        (bool hit, uint round) = EnumerableMap.tryGet(collectionRounds, idx);
        if (!hit) EnumerableMap.set(collectionRounds, idx, round); //未命中的话，round应为0
        bool existent = false;
        for (uint i; i < dataFeed[idx][round].prices.length; i++) {
            if (dataFeed[idx][round].prices[i].exchange == data.exchange) {
                existent = true;
                dataFeed[idx][round].prices[i] = data;
                break;
            }
        }
        if (!existent) dataFeed[idx][round].prices.push(data);
    }

    function finishRound(uint chainId, address collection) public override onlyExecutorOrOwner {
        uint idx = monitor.getNftContractIndex(chainId, collection);
        (bool hit, uint round) = EnumerableMap.tryGet(collectionRounds, idx);
        require(hit, "round non-existent");
        dataFeed[idx][round].timestamp = block.timestamp;
        EnumerableMap.set(collectionRounds, idx, round + 1);
    }

    function latestRoundData(uint chainId, address collection) public view override returns (CollectionRoundData memory) {
        uint idx = monitor.getNftContractIndex(chainId, collection);
        (bool hit, uint round) = EnumerableMap.tryGet(collectionRounds, idx);
        require(hit && round > 0, "round non-existent");
        return dataFeed[idx][round - 1];
    }
}
