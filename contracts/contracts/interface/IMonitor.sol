//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {ParamsOrderFulfilled} from "../base/SeaportTypes.sol";

interface IMonitor {
    event NewNftContract(address _sender, uint _chainId, bytes _address, bytes32 _hash);
    event NewNftItem(address _sender, bytes32 _contractHash, uint _tokenId, bytes32 _hash);

    function getNftContractIndex(uint chainId, address nft) external view returns (uint);

    function getNftItemIndex(
        uint chainId,
        address nft,
        uint tokenId
    ) external view returns (uint);

    function containsEvent(
        uint chainId,
        bytes32 tranHash,
        uint logIndex
    ) external view returns (bool existent);

    function seaportOrderFulfilled(
        ParamsOrderFulfilled calldata order,
        uint chainId,
        bytes32 tranHash,
        uint logIndex
    ) external;
}
