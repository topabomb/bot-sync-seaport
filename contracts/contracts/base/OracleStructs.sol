//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {ItemType} from "./SeaportTypes.sol";

enum Exchange {
    seaport,
    looksrare
}
struct NftContract {
    uint chainId;
    bytes contractAddr; //使用bytes兼容其他非evm链
    ItemType nftType;
}
struct NftItem {
    bytes32 contractHash;
    uint tokenId;
}
struct ExchangePrice {
    Exchange exchange;
    uint swapAmount;
    address tokenAddress;
    ItemType itemType;
}
struct CollectionRoundData {
    uint timestamp;
    ExchangePrice[] prices;
}
