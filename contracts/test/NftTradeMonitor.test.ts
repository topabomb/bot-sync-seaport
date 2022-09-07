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
      const tokens = [
        '0x495f947276749ce646f68ac8c248420045cb7b51',
        '0x495f947276749ce646f68ac8c248420045cb7b52',
        '0x495f947276749ce646f68ac8c248420045cb7b53',
        '0x495f947276749ce646f68ac8c248420045cb7b54',
        '0x495f947276749ce646f68ac8c248420045cb7b55',
      ];
      const swapToken = '0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA';
      const recipients = [
        '0x9d6cb1214A76E00252949C1972f02Fc43bd7F167',
        '0x0000a26b00c1F0DF003000390027140000fAa719',
        '0x5493518B4518D465aa61965a4f9510f39E6afa46',
      ];
      const tokenid = 0x2;
      const logIndex = 0x1;
      const offer = {
        token: '0xc36cF0cFcb5d905B8B513860dB0CFE63F6Cf9F5c',
        identifier: tokenid,
        itemType: 2,
        amount: 0x1,
      };
      const consideration = {
        token: swapToken,
        identifier: 0x0,
        itemType: 0,
        amount: 0x1,
        recipient: '0x9d6cb1214A76E00252949C1972f02Fc43bd7F167',
      };
      const order = {
        orderHash: '0xb4e53f0ff266bf348e22df12a611eaaff017df75fba86f32245219af7aac98b5',
        offerer: '0x9d6cb1214A76E00252949C1972f02Fc43bd7F167',
        zone: '0x004C00500000aD104D7DBd00e3ae0A5C00560C00',
        recipient: '0x8b0e03f41cD3cFF70d72346C9e92A49b81720855',
        offer: tokens.map((v) => ({ ...offer, token: v })),
        consideration: recipients.map((v) => ({ ...consideration, recipient: v })),
      };
      const chainId = 0x1;
      const tx = await monitor.seaportOrderFulfilled(order, chainId, HashZero, logIndex);
      await tx.wait();
      expect(await monitor.getItemCount()).to.equal(tokens.length);
      for (let i = 0; i < tokens.length; i++) {
        const nfthash = ethers.utils.solidityKeccak256(['uint256', 'address'], [chainId, tokens[i]]);
        const itemhash = ethers.utils.solidityKeccak256(['uint256', 'address', 'uint256'], [chainId, tokens[i], tokenid]);
        expect(await monitor.getNftContractHashByIndex(i)).to.equal(nfthash);
        expect(await monitor.getNftItemHashByIndex(i)).to.equal(itemhash);

        let nftInfo = await monitor.getNftContractByIndex(i);
        expect(nftInfo.chainId).to.equal(chainId);
        expect(nftInfo.contractAddr).to.equal(tokens[i]);

        nftInfo = await monitor.getNftContract(chainId, tokens[i]);
        expect(nftInfo.chainId).to.equal(chainId);
        expect(nftInfo.contractAddr).to.equal(tokens[i]);

        const tokenInfo = await monitor.getNftItemByIndex(i);
        expect(tokenInfo.tokenId).to.equal(tokenid);
        expect(tokenInfo.contractHash).to.equal(nfthash);

        nftInfo = await monitor.getNftItem(chainId, tokens[i], tokenid);
        expect(tokenInfo.tokenId).to.equal(tokenid);
        expect(tokenInfo.contractHash).to.equal(nfthash);
      }

      await monitor.clean();
      expect(await monitor.getContractCount()).to.equal(0);
      expect(await monitor.getItemCount()).to.equal(0);
      for (let i = 0; i < tokens.length; i++) {
        await expect(monitor.getNftContractByIndex(i)).to.be.rejectedWith('contract idx non-existent');
        await expect(monitor.getNftContractHashByIndex(i)).to.be.rejectedWith('contract idx non-existent');
        await expect(monitor.getNftItemByIndex(i)).to.be.rejectedWith('item idx non-existent');
        await expect(monitor.getNftItemHashByIndex(i)).to.be.rejectedWith('item idx non-existent');
      }
    });
  });
});
