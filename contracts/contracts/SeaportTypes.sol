//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
//修改seaport的event(OrderFulfilled)为struct用于参数传递
struct ParamsOrderFulfilled {
    bytes32 orderHash;
    address offerer;
    address zone;
    address recipient;
    SpentItem[] offer;
    ReceivedItem[] consideration;
}
struct SpentItem {
    ItemType itemType;
    address token;
    uint256 identifier;
    uint256 amount;
}
struct ReceivedItem {
    ItemType itemType;
    address token;
    uint256 identifier;
    uint256 amount;
    address payable recipient;
}
enum ItemType {
    // 0: ETH on mainnet, MATIC on polygon, etc.
    NATIVE,
    // 1: ERC20 items (ERC777 and ERC20 analogues could also technically work)
    ERC20,
    // 2: ERC721 items
    ERC721,
    // 3: ERC1155 items
    ERC1155,
    // 4: ERC721 items where a number of tokenIds are supported
    ERC721_WITH_CRITERIA,
    // 5: ERC1155 items where a number of ids are supported
    ERC1155_WITH_CRITERIA
}
