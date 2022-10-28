import hre from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';
import MerkleTree from 'merkletreejs';
const padBuffer = (addr: string) => {
  return Buffer.from(addr.substring(2).padStart(32 * 2, '0'), 'hex');
};
describe('验证默克尔树白名单', () => {
  async function deployFixture() {
    const [owner] = await ethers.getSigners();
    const WhiteList = await ethers.getContractFactory('MerkleProofWhiteList');
    const whitelist = await upgrades.deployProxy(WhiteList, [], {});
    await whitelist.deployed();
    return { whitelist: whitelist.connect(owner) };
  }
  describe('主流程', () => {
    it('通过地址列表验证', async () => {
      const [owner, listedAcct, unlistedAcct] = await ethers.getSigners();

      const { whitelist } = await loadFixture(deployFixture);
      //白名单
      const list = [owner.address, listedAcct.address];

      const leaves = list.map((account) => padBuffer(account));
      const tree = new MerkleTree(leaves, ethers.utils.keccak256, { sort: true });
      console.log('默克尔树\n', tree.toString());
      const rootHex = tree.getHexRoot(); //本list的默克尔根
      expect(ethers.utils.isHexString(rootHex)).to.eq(true);
      //设置当前轮的root
      await (await whitelist.connect(owner).ChangeRootOfCurrentRound(rootHex)).wait();
      //验证能够领取
      const listedProof = tree.getHexProof(padBuffer(listedAcct.address));
      expect(await whitelist.connect(listedAcct).CanClaime(listedProof)).to.equal(true);
      await (await whitelist.connect(listedAcct).Claime(listedProof)).wait();
      expect(await whitelist.connect(listedAcct).CanClaime(listedProof)).to.equal(false);
      //验证不能够领取
      const unlistedProof = tree.getHexProof(padBuffer(unlistedAcct.address));
      expect(await whitelist.connect(unlistedAcct).CanClaime(unlistedProof)).to.equal(false);
      await expect(whitelist.connect(unlistedAcct).Claime(unlistedProof)).to.be.rejectedWith('not claime');
      //增加unlisted再验证
      list.push(unlistedAcct.address);
      list.map((account) => padBuffer(account));
      const newTree = new MerkleTree(
        list.map((account) => padBuffer(account)),
        ethers.utils.keccak256,
        { sort: true }
      );
      console.log('新默克尔树\n', newTree.toString());
      const newRootHex = newTree.getHexRoot(); //本list的默克尔根
      await (await whitelist.connect(owner).ChangeRootOfCurrentRound(newRootHex)).wait();
      const newlistedProof = newTree.getHexProof(padBuffer(unlistedAcct.address));
      expect(await whitelist.connect(unlistedAcct).CanClaime(newlistedProof)).to.equal(true);
      await (await whitelist.connect(unlistedAcct).Claime(newlistedProof)).wait();
      expect(await whitelist.connect(unlistedAcct).CanClaime(newlistedProof)).to.equal(false);
    });
    it('大量列表验证', async () => {
      const [owner] = await ethers.getSigners();
      const { whitelist } = await loadFixture(deployFixture);
      //大量白名单
      const acctList = await ethers.getSigners();

      const tree2 = new MerkleTree(
        acctList.map((x) => padBuffer(x.address)),
        ethers.utils.keccak256,
        { sort: true }
      );
      const tree2Root = tree2.getHexRoot(); //本list的默克尔根
      console.log('tree2\n', tree2.toString());
      console.log('tree2Root', tree2Root);
      await (await whitelist.connect(owner).ChangeRootOfCurrentRound(tree2Root)).wait();
      for (const acct of acctList) {
        const proof = tree2.getHexProof(padBuffer(acct.address));
        console.log(`acct(${acct.address}) ,proof:`, proof);
        expect(tree2.verify(proof, padBuffer(acct.address), tree2Root)).to.eq(true);
        expect(await whitelist.connect(acct).CanClaime(proof)).to.equal(true);
        await (await whitelist.connect(acct).Claime(proof)).wait();
        expect(await whitelist.connect(acct).CanClaime(proof)).to.equal(false);
      }
      console.log('白名单总长度', acctList.length);
    });
  });
});
