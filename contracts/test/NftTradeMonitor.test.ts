import hre from 'hardhat';
import { time, loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { expect } from 'chai';
import { ethers, upgrades, tracer } from 'hardhat';
import { Console } from 'console';
export const AddressZero = '0x0000000000000000000000000000000000000000';
export const HashZero = '0x0000000000000000000000000000000000000000000000000000000000000000';
describe('NftTradeMonitor主流程', () => {
  async function deployFixture() {
    const [owner] = await ethers.getSigners();
    const Monitor = await ethers.getContractFactory('NftTradeMonitor');
    const monitor = await upgrades.deployProxy(Monitor, [], {});
    await monitor.deployed();
    return { monitor: monitor.connect(owner) };
  }
  describe('主流程', () => {
    it('通过地址列表验证', async () => {
      const { monitor } = await loadFixture(deployFixture);
      expect(await monitor.getItemCount()).to.equal(0);
      const addresses = [
        '0x495f947276749ce646f68ac8c248420045cb7b51',
        '0x495f947276749ce646f68ac8c248420045cb7b52',
        '0x495f947276749ce646f68ac8c248420045cb7b53',
        '0x495f947276749ce646f68ac8c248420045cb7b54',
        '0x495f947276749ce646f68ac8c248420045cb7b55',
      ];
      const tokenid = 0x2;
      const logIndex = 0x1;
      const offer = {
        token: AddressZero,
        identifier: tokenid,
        itemType: 2,
        amount: 0x1,
      };
      const consideration = {
        token: AddressZero,
        identifier: tokenid,
        itemType: 2,
        amount: 0x1,
        recipient: AddressZero,
      };
      const order = {
        orderHash: HashZero,
        offerer: AddressZero,
        zone: AddressZero,
        recipient: AddressZero,
        offer: addresses.slice(0, 3).map((v) => ({ ...offer, token: v })),
        consideration: addresses.slice(1, 5).map((v) => ({ ...consideration, token: v })),
      };
      const chainId = 0x1;
      const tx = await monitor.seaportOrderFulfilled(order, chainId, HashZero, logIndex);
      await tx.wait();
      expect(await monitor.getItemCount()).to.equal(addresses.length);
      for (let i = 0; i < addresses.length; i++) {
        const nfthash = ethers.utils.solidityKeccak256(['uint256', 'address'], [chainId, addresses[i]]);
        const itemhash = ethers.utils.solidityKeccak256(['uint256', 'address', 'uint256'], [chainId, addresses[i], tokenid]);
        expect(await monitor.getNftContractHashByIndex(i)).to.equal(nfthash);
        expect(await monitor.getNftItemHashByIndex(i)).to.equal(itemhash);

        let nftInfo = await monitor.getNftContractByIndex(i);
        expect(nftInfo.chainId).to.equal(chainId);
        expect(nftInfo.contractAddr).to.equal(addresses[i]);

        nftInfo = await monitor.getNftContract(chainId, addresses[i]);
        expect(nftInfo.chainId).to.equal(chainId);
        expect(nftInfo.contractAddr).to.equal(addresses[i]);

        const tokenInfo = await monitor.getNftItemByIndex(i);
        expect(tokenInfo.tokenId).to.equal(tokenid);
        expect(tokenInfo.contractHash).to.equal(nfthash);

        nftInfo = await monitor.getNftItem(chainId, addresses[i], tokenid);
        expect(tokenInfo.tokenId).to.equal(tokenid);
        expect(tokenInfo.contractHash).to.equal(nfthash);
      }

      await monitor.clean();
      expect(await monitor.getContractCount()).to.equal(0);
      expect(await monitor.getItemCount()).to.equal(0);
      for (let i = 0; i < addresses.length; i++) {
        await expect(monitor.getNftContractByIndex(i)).to.be.rejectedWith('contract idx non-existent');
        await expect(monitor.getNftContractHashByIndex(i)).to.be.rejectedWith('contract idx non-existent');
        await expect(monitor.getNftItemByIndex(i)).to.be.rejectedWith('item idx non-existent');
        await expect(monitor.getNftItemHashByIndex(i)).to.be.rejectedWith('item idx non-existent');
      }
    });
  });
});
