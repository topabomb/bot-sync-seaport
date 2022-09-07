// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

abstract contract ExecutorBase is OwnableUpgradeable {
    using EnumerableSet for EnumerableSet.AddressSet;
    modifier onlyExecutorOrOwner() {
        require(
            EnumerableSet.contains(allExecutors, _msgSender()) || owner() == _msgSender(),
            "Executor: caller is not the executor or owner."
        );
        _;
    }
    EnumerableSet.AddressSet private allExecutors;

    function addExecutor(address executor) public onlyOwner returns (bool) {
        return EnumerableSet.add(allExecutors, executor);
    }

    function removeExecutor(address executor) public onlyOwner returns (bool) {
        return EnumerableSet.remove(allExecutors, executor);
    }

    function containsExecutor(address executor) public view returns (bool) {
        return EnumerableSet.contains(allExecutors, executor);
    }

    function getExecutor(uint index) public view returns (address) {
        return EnumerableSet.at(allExecutors, index);
    }

    function allExecutorsValues() public view returns (address[] memory) {
        return EnumerableSet.values(allExecutors);
    }

    function allExecutorsLength() public view returns (uint) {
        return EnumerableSet.length(allExecutors);
    }
}
