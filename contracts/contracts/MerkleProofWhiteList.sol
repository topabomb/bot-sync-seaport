//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract MerkleProofWhiteList is OwnableUpgradeable {
    using Counters for Counters.Counter;
    mapping(uint => bytes32) roundRoots; //每轮次的默克尔根
    mapping(uint => mapping(address => bool)) roundClaimed; //round->account->claimed
    Counters.Counter private roundCounter; //当前轮次

    function initialize() public initializer {
        __Ownable_init();
    }

    function AddresstoBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    function VerifyProofOfRound(
        uint round,
        address account,
        bytes32[] calldata proof
    ) internal view returns (bool) {
        return MerkleProof.verify(proof, roundRoots[round], AddresstoBytes32(account));
    }

    function ChangeRootOfCurrentRound(bytes32 root) public onlyOwner {
        roundRoots[roundCounter.current()] = root;
    }

    function NextRound(bytes32 root) public onlyOwner {
        roundCounter.increment();
        roundRoots[roundCounter.current()] = root;
    }

    function InCurrentRound(bytes32[] calldata merkleProof) public view returns (bool hit) {
        hit = VerifyProofOfRound(roundCounter.current(), _msgSender(), merkleProof);
    }

    function CanClaime(bytes32[] calldata merkleProof) public view returns (bool can) {
        can = !roundClaimed[roundCounter.current()][_msgSender()];
        if (can) {
            can = InCurrentRound(merkleProof);
        }
    }

    function Claime(bytes32[] calldata merkleProof) public {
        require(CanClaime(merkleProof), "not claime");
        //具体逻辑开始

        //具体逻辑结束
        roundClaimed[roundCounter.current()][_msgSender()] = true;
    }
}
