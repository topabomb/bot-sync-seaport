//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "./base/ExecutorBase.sol";
import "./interface/IMonitor.sol";
import "./interface/ICollectionOracle.sol";

import {Exchange, NftContract, NftItem} from "./base/OracleStructs.sol";
import {ParamsOrderFulfilled, SpentItem, ReceivedItem, ItemType} from "./base/SeaportTypes.sol";

contract SeaportFeedExecutor is ExecutorBase {
    IMonitor internal monitor;
    ICollectionOracle internal oracle;
    //交易HASH处理，key=hash(chainId+tranHash)
    EnumerableSet.Bytes32Set internal tranHash_indexes;

    function initialize(address monitorAddr, address oraceAddress) public initializer {
        __Ownable_init();
        monitor = IMonitor(monitorAddr);
        oracle = ICollectionOracle(oraceAddress);
    }

    function containsEvent(
        uint chainId,
        bytes32 tranHash,
        uint logIndex
    ) public view returns (bool existent) {
        bytes32 localTranHash = keccak256(abi.encodePacked(chainId, tranHash, logIndex));
        existent = EnumerableSet.contains(tranHash_indexes, localTranHash);
    }

    function _addTranHash(
        uint chainId,
        bytes32 tranHash,
        uint logIndex
    ) internal returns (bool) {
        bytes32 localTranHash = keccak256(abi.encodePacked(chainId, tranHash, logIndex));
        return EnumerableSet.add(tranHash_indexes, localTranHash);
    }

    function seaportOrderFulfilled(
        ParamsOrderFulfilled calldata order,
        uint chainId,
        bytes32 tranHash,
        uint logIndex
    ) public onlyExecutorOrOwner {
        require(_addTranHash(chainId, tranHash, logIndex), "tran existent");
        if (!monitor.containsEvent(chainId, tranHash, logIndex)) monitor.seaportOrderFulfilled(order, chainId, tranHash, logIndex);
        bool isSell = (order.offer[0].itemType != ItemType.NATIVE && order.offer[0].itemType != ItemType.ERC20) ? true : false;
        require(isSell ? order.offer.length == 1 : order.consideration.length == 1, "err args"); //仅支持一个标的的订单处理
        address sellToken = isSell ? order.offer[0].token : order.consideration[0].token;
        uint sellAmount = isSell ? order.offer[0].amount : order.consideration[0].amount;
        address swapToken = isSell ? order.consideration[0].token : order.offer[0].token;
        ItemType nftType = isSell ? order.consideration[0].itemType : order.offer[0].itemType;
        uint swapAmount = isSell ? order.consideration[0].amount : order.offer[0].amount;
        uint length = isSell ? order.consideration.length : order.offer.length;
        unchecked {
            for (uint i = 1; i < length; i++) {
                address token = isSell ? order.consideration[i].token : order.offer[i].token;
                require(swapToken == token, "only one token");
                swapAmount += isSell ? order.consideration[i].amount : order.offer[i].amount;
            }
        }
        swapAmount = swapAmount / sellAmount;
        oracle.submitRoundData(chainId, sellToken, ExchangePrice(Exchange.seaport, swapAmount, swapToken, nftType));
    }
}
