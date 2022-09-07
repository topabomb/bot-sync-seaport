//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./base/ExecutorBase.sol";
import {Exchange, NftContract, NftItem} from "./base/OracleStructs.sol";
import {ParamsOrderFulfilled, SpentItem, ReceivedItem, ItemType} from "./base/SeaportTypes.sol";
import "./interface/IMonitor.sol";

contract NftTradeMonitor is ExecutorBase, IMonitor {
    using Counters for Counters.Counter;
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    event SeaportOrderFulfilled(
        uint _chainId,
        bytes32 _tranHash,
        uint _logIndex,
        bytes32 orderHash,
        address indexed offerer,
        address indexed zone,
        address recipient,
        SpentItem[] offer,
        ReceivedItem[] consideration
    );
    struct ParamsNftItem {
        ItemType itemType;
        address nftAddress;
        bytes32 itemhash;
        uint tokenId;
    }

    //contracts的标识符为byte32=hash(chainId+Address)，映射关系为 byte32=>uint=>NftContract
    mapping(uint => NftContract) contracts;
    EnumerableMap.Bytes32ToUintMap internal contract_indexes; //hash的映射
    //item的标识符为：byte32=hash(chainId+Address+TokenId)，映射关系为 byte32=>uint=>NftItem
    mapping(uint => NftItem) items;
    EnumerableMap.Bytes32ToUintMap internal item_indexes; //hash的映射
    //交易HASH处理，key=hash(chainId+tranHash)
    EnumerableSet.Bytes32Set internal tranHash_indexes;

    function initialize() public initializer {
        __Ownable_init();
    }

    function _processSeaportOrderFulfilled(ParamsOrderFulfilled calldata order, uint chainId)
        internal
        returns (ParamsNftItem[] memory results, uint length)
    {
        uint total = order.offer.length + order.consideration.length;
        results = new ParamsNftItem[](total);
        length = 0;
        unchecked {
            uint offerLength = order.offer.length;
            for (uint i = 0; i < offerLength; i++) {
                if (order.offer[i].itemType == ItemType.ERC721 || order.offer[i].itemType == ItemType.ERC1155) {
                    results[i] = ParamsNftItem(
                        order.offer[i].itemType,
                        order.offer[i].token,
                        getNftItemHash(chainId, order.offer[i].token, order.offer[i].identifier),
                        order.offer[i].identifier
                    );
                    length++;
                }
            }
            uint considerationLength = order.consideration.length;
            for (uint i = 0; i < considerationLength; i++) {
                if (order.consideration[i].itemType == ItemType.ERC721 || order.consideration[i].itemType == ItemType.ERC1155) {
                    results[i] = ParamsNftItem(
                        order.consideration[i].itemType,
                        order.consideration[i].token,
                        getNftItemHash(chainId, order.consideration[i].token, order.consideration[i].identifier),
                        order.consideration[i].identifier
                    );
                    length++;
                }
            }
        }
    }

    function containsTransaction(uint chainId, bytes32 tranHash) public view override returns (bool existent) {
        bytes32 localTranHash = keccak256(abi.encodePacked(chainId, tranHash));
        existent = EnumerableSet.contains(tranHash_indexes, localTranHash);
    }

    function _addTranHash(uint chainId, bytes32 tranHash) internal returns (bool) {
        bytes32 localTranHash = keccak256(abi.encodePacked(chainId, tranHash));
        return EnumerableSet.add(tranHash_indexes, localTranHash);
    }

    function _seaportOrderFulfilledAfter(
        ParamsOrderFulfilled calldata order,
        uint chainId,
        bytes32 tranHash,
        uint logIndex
    ) internal {
        emit SeaportOrderFulfilled(
            chainId,
            tranHash,
            logIndex,
            order.orderHash,
            order.offerer,
            order.zone,
            order.recipient,
            order.offer,
            order.consideration
        );
    }

    function seaportOrderFulfilled(
        ParamsOrderFulfilled calldata order,
        uint chainId,
        bytes32 tranHash,
        uint logIndex
    ) public override onlyExecutorOrOwner {
        if (_addTranHash(chainId, tranHash)) {
            (ParamsNftItem[] memory paramTokens, uint length) = _processSeaportOrderFulfilled(order, chainId);
            //逐一处理nft资产
            uint lastContractIdx = EnumerableMap.length(contract_indexes);
            uint lastItemIdx = EnumerableMap.length(item_indexes);
            unchecked {
                for (uint i = 0; i < length; i++) {
                    if (EnumerableMap.set(item_indexes, paramTokens[i].itemhash, lastItemIdx)) {
                        bytes memory constantAddrBytes = abi.encodePacked(paramTokens[i].nftAddress);
                        //处理Contract
                        bytes32 contractHash = getNftContractHash(chainId, paramTokens[i].nftAddress);
                        if (EnumerableMap.set(contract_indexes, contractHash, lastContractIdx)) {
                            contracts[lastContractIdx++] = NftContract(chainId, constantAddrBytes, paramTokens[i].itemType);
                            emit NewNftContract(_msgSender(), chainId, constantAddrBytes, contractHash);
                        }
                        items[lastItemIdx++] = NftItem(contractHash, paramTokens[i].tokenId);
                        emit NewNftItem(_msgSender(), contractHash, paramTokens[i].tokenId, paramTokens[i].itemhash);
                    }
                }
            }
            _seaportOrderFulfilledAfter(order, chainId, tranHash, logIndex);
        }
    }

    function seaportOrderFulfilledBatch(
        ParamsOrderFulfilled[] calldata orders,
        uint chainId,
        bytes32[] calldata tranHashs,
        uint[] calldata logIndexs
    ) public onlyExecutorOrOwner {
        require(tranHashs.length == orders.length && logIndexs.length == orders.length && orders.length > 0, "err args");
        for (uint i = 0; i < orders.length; i++) {
            if (!containsTransaction(chainId, tranHashs[i])) {
                seaportOrderFulfilled(orders[i], chainId, tranHashs[i], logIndexs[i]);
            }
        }
    }

    function clean() public onlyOwner {
        unchecked {
            uint itemLength = EnumerableMap.length(item_indexes);
            for (uint i = itemLength; i > 0; i--) {
                delete items[i - 1];
                (bytes32 hash, ) = EnumerableMap.at(item_indexes, i - 1);
                EnumerableMap.remove(item_indexes, hash);
            }
            uint contractLength = EnumerableMap.length(contract_indexes);
            for (uint i = contractLength; i > 0; i--) {
                delete contracts[i - 1];
                (bytes32 hash, ) = EnumerableMap.at(contract_indexes, i - 1);
                EnumerableMap.remove(contract_indexes, hash);
            }
        }
    }

    /** NftContract*/
    function getNftContractHash(uint chain, address addr) public view returns (bytes32) {
        return keccak256(abi.encodePacked(chain, addr));
    }

    function getContractCount() public view returns (uint) {
        return EnumerableMap.length(contract_indexes);
    }

    function getNftContractHashByIndex(uint idx) public view returns (bytes32 hash) {
        require(idx < EnumerableMap.length(contract_indexes), "contract idx non-existent");
        (hash, ) = EnumerableMap.at(contract_indexes, idx);
    }

    function getNftContractByIndex(uint idx) public view returns (NftContract memory) {
        require(contracts[idx].chainId > 0, "contract idx non-existent");
        return contracts[idx];
    }

    function getNftContractIndex(uint chainId, address nft) public view override returns (uint) {
        return EnumerableMap.get(contract_indexes, getNftContractHash(chainId, nft));
    }

    function getNftContract(uint chainId, address nft) public view returns (NftContract memory) {
        return contracts[getNftContractIndex(chainId, nft)];
    }

    /** NftItem*/
    function getNftItemHash(
        uint chain,
        address addr,
        uint id
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(chain, addr, id));
    }

    function getItemCount() public view returns (uint) {
        return EnumerableMap.length(item_indexes);
    }

    function getNftItemHashByIndex(uint idx) public view returns (bytes32 hash) {
        require(idx < EnumerableMap.length(item_indexes), "item idx non-existent");
        (hash, ) = EnumerableMap.at(item_indexes, idx);
    }

    function getNftItemByIndex(uint idx) public view returns (NftItem memory) {
        require(items[idx].contractHash != "", "item idx non-existent");
        return items[idx];
    }

    function getNftItemIndex(
        uint chainId,
        address nft,
        uint tokenId
    ) public view override returns (uint) {
        return EnumerableMap.get(item_indexes, getNftItemHash(chainId, nft, tokenId));
    }

    function getNftItem(
        uint chainId,
        address nft,
        uint tokenId
    ) public view returns (NftItem memory) {
        return items[getNftItemIndex(chainId, nft, tokenId)];
    }
}
