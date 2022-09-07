//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {CollectionRoundData, ExchangePrice, Exchange} from "../base/OracleStructs.sol";

interface ICollectionOracle {
    function submitRoundData(
        uint chainId,
        address collection,
        ExchangePrice calldata data
    ) external;

    function finishRound(uint chainId, address collection) external;

    function latestRoundData(uint chainId, address collection) external view returns (CollectionRoundData memory);
}
