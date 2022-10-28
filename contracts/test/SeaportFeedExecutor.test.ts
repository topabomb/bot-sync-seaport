import hre from 'hardhat';
import { time, loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { expect } from 'chai';
import { ethers, upgrades, tracer } from 'hardhat';
import { Console } from 'console';
export const AddressZero = '0x0000000000000000000000000000000000000000';
export const HashZero = '0x0000000000000000000000000000000000000000000000000000000000000000';
describe('SeaportFeedExecutor主流程', () => {
  async function deployFixture() {
    const [owner] = await ethers.getSigners();
    const Monitor = await ethers.getContractFactory('NftTradeMonitor');
    const monitor = await upgrades.deployProxy(Monitor, [], {});
    await monitor.deployed();
    const Feed = await ethers.getContractFactory('NftCollectionFeed');
    const feed = await upgrades.deployProxy(Feed, [monitor.address], {});
    await feed.deployed();
    const Executor = await ethers.getContractFactory('SeaportFeedExecutor');
    const executor = await upgrades.deployProxy(Executor, [monitor.address, feed.address], {});
    await executor.deployed();

    //添加executor
    await (await monitor.addExecutor(feed.address)).wait();
    await (await monitor.addExecutor(executor.address)).wait();
    await (await feed.addExecutor(executor.address)).wait();
    return { monitor: monitor.connect(owner), feed: feed.connect(owner), executor: executor.connect(owner) };
  }
  describe('主流程', () => {
    it('提交Seaport事件', async () => {
      const { monitor, feed, executor } = await loadFixture(deployFixture);
      const nftAddress = '0xcCA8050215E585E2a223C6eA9D1D1F9b30BEAf3e';
      const swapToken = AddressZero;
      const hashs = [
        '0x95d74b096f69fd295afe2a0cd96298f0d50b19bcd87c9d2d80e2946986275e9d',
        '0x95d74b096f69fd295afe2a0cd96298f0d50b19bcd87c9d2d80e2946986275e9e',
        '0x95d74b096f69fd295afe2a0cd96298f0d50b19bcd87c9d2d80e2946986275e9f',
      ];
      const recipients = [
        '0x9d6cb1214A76E00252949C1972f02Fc43bd7F167',
        '0x0000a26b00c1F0DF003000390027140000fAa719',
        '0x5493518B4518D465aa61965a4f9510f39E6afa46',
      ];
      const swapAmount = ethers.utils.parseEther('0.1');
      const tokenids = [0x1, 0x2, 0x3];
      const logIndex = 0x1;
      const offer = {
        token: nftAddress,
        identifier: 0x0,
        itemType: 2,
        amount: 0x1,
      };
      const consideration = {
        token: swapToken,
        identifier: 0x0,
        itemType: 0,
        amount: 0x0,
        recipient: AddressZero,
      };
      const order = {
        orderHash: HashZero,
        offerer: AddressZero,
        zone: AddressZero,
        recipient: AddressZero,
        offer: [offer],
        consideration: recipients.map((v) => ({ ...consideration, recipient: v, amount: swapAmount })),
      };
      const chainId = 0x1;
      for (let i = 0; i < hashs.length; i++) {
        order.offer[0].identifier = tokenids[i];
        await (await executor.seaportOrderFulfilled({ ...order }, chainId, hashs[i], logIndex)).wait();
      }
      await (await feed.finishRound(chainId, nftAddress)).wait();
      const roundInfo = await feed.latestRoundData(chainId, nftAddress);
      //console.log(roundInfo);
      expect(roundInfo.prices[0].swapAmount).to.equal(swapAmount.mul('3'));
      expect(await monitor.getContractCount()).to.equal(1);
      expect(await monitor.getItemCount()).to.equal(3);
    });
  });
});
