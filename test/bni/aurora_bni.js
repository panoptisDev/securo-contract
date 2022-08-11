const { expect } = require("chai");
const { assert, ethers, deployments } = require("hardhat");
const { expectRevert } = require('@openzeppelin/test-helpers');
const { BigNumber } = ethers;
const parseEther = ethers.utils.parseEther;
const AddressZero = ethers.constants.AddressZero;
const { increaseTime } = require("../../scripts/utils/ethereum");

const ERC20_ABI = require("@openzeppelin/contracts-upgradeable/build/contracts/ERC20Upgradeable.json").abi;

const { common, auroraMainnet: network_ } = require("../../parameters");

const DAY = 24 * 3600;

function getUsdtAmount(amount) {
  return BigNumber.from(amount).mul(BigNumber.from(10).pow(6))
}

describe("BNI on Aurora", async () => {

    let vault, strategy, priceOracle, usdt;
    let vaultArtifact, strategyArtifact, l2VaultArtifact;
    let admin;

    before(async () => {
      [deployer, a1, a2, ...accounts] = await ethers.getSigners();
  
      vaultArtifact = await deployments.getArtifact("BNIVault");
      strategyArtifact = await deployments.getArtifact("AuroraBNIStrategy");
      priceOracleArtifact = await deployments.getArtifact("AuroraPriceOracle");
      l2VaultArtifact = await deployments.getArtifact("AuroraBastionVault");
    });
  
    beforeEach(async () => {
      await deployments.fixture(["hardhat_aurora_bni"])

      const vaultProxy = await ethers.getContract("BNIVault_Proxy");
      vault = new ethers.Contract(vaultProxy.address, vaultArtifact.abi, a1);
      const strategyProxy = await ethers.getContract("AuroraBNIStrategy_Proxy");
      strategy = new ethers.Contract(strategyProxy.address, strategyArtifact.abi, a1);
      const priceOracleProxy = await ethers.getContract("AuroraPriceOracle_Proxy");
      priceOracle = new ethers.Contract(priceOracleProxy.address, priceOracleArtifact.abi, a1);

      admin = await ethers.getSigner(common.admin);

      usdt = new ethers.Contract(network_.Swap.USDT, ERC20_ABI, deployer);
    });

    describe('Basic', () => {
      it("Should be set with correct initial vaule", async () => {
        expect(await priceOracle.owner()).equal(deployer.address);

        expect(await vault.owner()).equal(deployer.address);
        expect(await vault.admin()).equal(common.admin);
        expect(await vault.trustedForwarder()).equal(AddressZero);
        expect(await vault.strategy()).equal(strategy.address);
        expect(await vault.priceOracle()).equal(priceOracle.address);
        expect(await vault.USDT()).equal(network_.Swap.USDT);

        expect(await strategy.owner()).equal(deployer.address);
        expect(await strategy.treasuryWallet()).equal(common.treasury);
        expect(await strategy.admin()).equal(common.admin);
        expect(await strategy.vault()).equal(vault.address);
        expect(await strategy.priceOracle()).equal(priceOracle.address);
        expect(await strategy.router()).equal(network_.Swap.router);
        expect(await strategy.SWAP_BASE_TOKEN()).equal(network_.Swap.SWAP_BASE_TOKEN);
        expect(await strategy.USDT()).equal(network_.Swap.USDT);
        expect(await strategy.tokens(0)).equal(network_.Swap.WNEAR);
        expect(await strategy.pid(network_.Swap.WNEAR)).equal(0);
        const WNEARVaultAddr = await strategy.WNEARVault();

        const WNEARVault = new ethers.Contract(WNEARVaultAddr, l2VaultArtifact.abi, a1);
        expect(await WNEARVault.name()).equal('BNI L2 WNEAR');
        expect(await WNEARVault.symbol()).equal('bniL2WNEAR');
        expect(await WNEARVault.cToken()).equal(network_.Bastion.cNEAR);
        expect(await WNEARVault.admin()).equal(common.admin);
        expect(await WNEARVault.treasuryWallet()).equal(common.treasury);
        expect(await WNEARVault.yieldFee()).equal(2000);
      });

      it("Should be set by only owner", async () => {
        await expectRevert(priceOracle.setAssetSources([a2.address],[a1.address]), "Ownable: caller is not the owner");

        await expectRevert(vault.setAdmin(a2.address), "Ownable: caller is not the owner");
        await expectRevert(vault.setBiconomy(a2.address), "Ownable: caller is not the owner");
        await expectRevert(vault.depositByAdmin(a1.address, [a2.address], [getUsdtAmount('100')], 1), "Only owner or admin");
        await expectRevert(vault.withdrawPercByAdmin(a1.address, parseEther('0.1'), 1), "Only owner or admin");
        await expectRevert(vault.rebalance(0, parseEther('0.1'), a2.address), "Only owner or admin");
        await expectRevert(vault.emergencyWithdraw(), "Only owner or admin");
        await expectRevert(vault.reinvest([a2.address], [10000]), "Only owner or admin");
        await expectRevert(vault.setTreasuryWallet(a2.address), "Ownable: caller is not the owner");

        await expectRevert(strategy.addToken(a1.address), "Ownable: caller is not the owner");
        await expectRevert(strategy.removeToken(1), "Ownable: caller is not the owner");
        await expectRevert(strategy.setTreasuryWallet(a2.address), "Ownable: caller is not the owner");
        await expectRevert(strategy.setAdmin(a2.address), "Ownable: caller is not the owner");
        await expectRevert(strategy.setVault(a2.address), "Ownable: caller is not the owner");

        const WNEARVault = new ethers.Contract(await strategy.WNEARVault(), l2VaultArtifact.abi, a1);

        await expectRevert(WNEARVault.setAdmin(a2.address), "Ownable: caller is not the owner");
        await WNEARVault.connect(deployer).setAdmin(a2.address);
        expect(await WNEARVault.admin()).equal(a2.address);
        await WNEARVault.connect(deployer).setAdmin(accounts[0].address);

        await expectRevert(WNEARVault.setTreasuryWallet(a2.address), "Ownable: caller is not the owner");
        await WNEARVault.connect(deployer).setTreasuryWallet(a2.address);
        expect(await WNEARVault.treasuryWallet()).equal(a2.address);
        await WNEARVault.connect(deployer).setTreasuryWallet(common.treasury);

        await expectRevert(WNEARVault.setFee(1000), "Ownable: caller is not the owner");
        await WNEARVault.connect(deployer).setFee(1000);
        expect(await WNEARVault.yieldFee()).equal(1000);

        await expectRevert(WNEARVault.yield(), "Only owner or admin");
        await WNEARVault.connect(accounts[0]).yield();

        await expectRevert(WNEARVault.emergencyWithdraw(), "Only owner or admin");
        await WNEARVault.connect(accounts[0]).emergencyWithdraw();
        await expectRevert(WNEARVault.connect(deployer).emergencyWithdraw(), "Pausable: paused");

        await expectRevert(WNEARVault.reinvest(), "Only owner or admin");
        await WNEARVault.connect(accounts[0]).reinvest();
        await expectRevert(WNEARVault.connect(deployer).reinvest(), "Pausable: not paused");

        await expectRevert(WNEARVault.updateRewardDistributor(), "Ownable: caller is not the owner");
      });

      it("Should be returned with correct default vaule", async () => {
        expect(await vault.getAPR()).gt(0);
        expect(await vault.getAllPoolInUSD()).equal(0);

        var ret = await vault.getEachPoolInUSD();
        chainIDs = ret[0];
        tokens = ret[1];
        pools = ret[2];
        expect(chainIDs.length).equal(1);
        // expect(chainIDs[0]).equal(1313161554);
        expect(tokens[0]).equal(network_.Swap.WNEAR);
        expect(pools[0]).equal(0);
      });
    });

    describe('Basic function', () => {
      beforeEach(async () => {
        vault.connect(deployer).setAdmin(accounts[0].address);
        admin = accounts[0];
      });

      it("Basic Deposit/withdraw", async () => {
        await usdt.transfer(a1.address, getUsdtAmount('50000'));
        await usdt.connect(a1).approve(vault.address, getUsdtAmount('50000'));

        const WNEARVault = new ethers.Contract(await strategy.WNEARVault(), l2VaultArtifact.abi, a1);
        expect(await WNEARVault.getAPR()).gt(0);

        var ret = await vault.getEachPoolInUSD();
        var tokens = ret[1];
        await vault.connect(admin).depositByAdmin(a1.address, tokens, [getUsdtAmount('50000')], 1);
        await expectRevert(vault.connect(admin).depositByAdmin(a1.address, tokens, [getUsdtAmount('50000')], 1), "Nonce is behind");
        expect(await vault.firstOperationNonce()).equal(1);
        expect(await vault.lastOperationNonce()).equal(1);
        ret = await vault.poolAtNonce(1);
        expect(ret[0]).equal(0);
        expect(ret[1]).gt(0);
        expect(await vault.userLastOperationNonce(a1.address)).equal(1);
        expect(await vault.operationAmounts(1)).equal(getUsdtAmount('50000'));

        expect(await usdt.balanceOf(a1.address)).equal(0);
        expect(await vault.getAllPoolInUSD()).closeTo(parseEther('50000'), parseEther('50000').div(10));

        expect(await usdt.balanceOf(vault.address)).equal(0);
        expect(await usdt.balanceOf(strategy.address)).equal(0);
        const WNEAR = new ethers.Contract(network_.Swap.WNEAR, ERC20_ABI, deployer);
        expect(await WNEAR.balanceOf(strategy.address)).equal(0);
        expect(await WNEAR.balanceOf(WNEARVault.address)).equal(0);
        const cNEAR = new ethers.Contract(network_.Bastion.cNEAR, ERC20_ABI, deployer);
        expect(await cNEAR.balanceOf(WNEARVault.address)).gt(0);

        await increaseTime(DAY);
        expect(await WNEARVault.getPendingRewards()).equal(0);
        await WNEARVault.connect(deployer).setAdmin(admin.address);
        await WNEARVault.connect(admin).yield();

        await vault.connect(admin).withdrawPercByAdmin(a1.address, parseEther('1'), 2);
        await expectRevert(vault.connect(admin).withdrawPercByAdmin(a1.address, parseEther('1'), 2), "Nonce is behind");
        expect(await vault.firstOperationNonce()).equal(1);
        expect(await vault.lastOperationNonce()).equal(2);
        ret = await vault.poolAtNonce(2);
        expect(ret[0]).gt(0);
        expect(ret[1]).gt(0);
        expect(await vault.userLastOperationNonce(a1.address)).equal(2);
        expect(await vault.operationAmounts(2)).equal(parseEther('1'));

        expect(await usdt.balanceOf(a1.address)).closeTo(getUsdtAmount('50000'), getUsdtAmount('50000').div(10));
        expect(await vault.getAllPoolInUSD()).equal(0);

        expect(await usdt.balanceOf(vault.address)).equal(0);
        expect(await usdt.balanceOf(strategy.address)).equal(0);
        expect(await WNEAR.balanceOf(strategy.address)).equal(0);
        expect(await WNEAR.balanceOf(WNEARVault.address)).equal(0);
        expect(await cNEAR.balanceOf(WNEARVault.address)).equal(0);
      });

      it("emergencyWithdraw", async () => {
        await usdt.transfer(a1.address, getUsdtAmount('5000'));
        await usdt.connect(a1).approve(vault.address, getUsdtAmount('5000'));

        var ret = await vault.getEachPoolInUSD();
        var tokens = ret[1];
        await vault.connect(admin).depositByAdmin(a1.address, tokens, [getUsdtAmount('5000')], 1);

        await vault.connect(admin).emergencyWithdraw();
        expect(await usdt.balanceOf(vault.address)).closeTo(getUsdtAmount('5000'), getUsdtAmount('5000').div(20));

        ret = await vault.getCurrentCompositionPerc();
        await vault.connect(admin).reinvest(ret[0], ret[1]);
        expect(await usdt.balanceOf(vault.address)).equal(0);
        expect(await vault.getAllPoolInUSD()).closeTo(parseEther('5000'), parseEther('5000').div(10));

        await vault.connect(admin).emergencyWithdraw();

        await vault.connect(admin).withdrawPercByAdmin(a1.address, parseEther('1'), 2);
        expect(await usdt.balanceOf(a1.address)).closeTo(getUsdtAmount('5000'), getUsdtAmount('5000').div(10));
        expect(await vault.getAllPoolInUSD()).equal(0);
      });

      it("Rebalance", async () => {
        await usdt.transfer(a1.address, getUsdtAmount('5000'));
        await usdt.connect(a1).approve(vault.address, getUsdtAmount('5000'));

        await strategy.connect(deployer).addToken(network_.Swap.USDT);
        var ret = await vault.getEachPoolInUSD();
        var tokens = ret[1];
        await vault.connect(admin).depositByAdmin(a1.address, tokens, [getUsdtAmount('3000'),getUsdtAmount('2000')], 1);
        expect(await usdt.balanceOf(a1.address)).equal(0);
        expect(await vault.getAllPoolInUSD()).closeTo(parseEther('5000'), parseEther('5000').div(50));

        var tokenPerc = await vault.getCurrentCompositionPerc();
        expect(tokenPerc[0][0]).equal(network_.Swap.WNEAR);
        expect(tokenPerc[0][1]).equal(network_.Swap.USDT);
        expect(tokenPerc[1][0].toNumber()).closeTo(6000, 6000/50);
        expect(tokenPerc[1][1].toNumber()).closeTo(4000, 4000/50);

        await expectRevert(strategy.connect(deployer).removeToken(2), "Invalid pid")
        await expectRevert(strategy.connect(deployer).removeToken(1), "Pool is not empty")

        await vault.connect(admin).rebalance(1, parseEther('1'), network_.Swap.WNEAR);
        tokenPerc = await vault.getCurrentCompositionPerc();
        expect(tokenPerc[0][0]).equal(network_.Swap.WNEAR);
        expect(tokenPerc[0][1]).equal(network_.Swap.USDT);
        expect(tokenPerc[1][0].toNumber()).equal(10000);
        expect(tokenPerc[1][1].toNumber()).equal(0);

        await strategy.connect(deployer).removeToken(1);
        await vault.connect(admin).withdrawPercByAdmin(a1.address, parseEther('1'), 2);
        expect(await usdt.balanceOf(a1.address)).closeTo(getUsdtAmount('5000'), getUsdtAmount('5000').div(10));
        expect(await vault.getAllPoolInUSD()).equal(0);
      });
    });

    describe('Enable the Bastion supply reward for cNEAR', () => {
      let rewardDistributor;
      let cNEAR, BSTN;

      beforeEach(async () => {
        vault.connect(deployer).setAdmin(accounts[0].address);
        admin = accounts[0];

        await network.provider.request({method: "hardhat_impersonateAccount", params: ['0x4f44d184908AE367CAD0cb1b332A11545d76Bc87']});
        const rewardAdmin = await ethers.getSigner('0x4f44d184908AE367CAD0cb1b332A11545d76Bc87');
        rewardDistributor = new ethers.Contract('0x98E8d4b4F53FA2a2d1b9C651AF919Fc839eE4c1a', [
          'function _setRewardSpeed(uint8 rewardType, address cToken, uint256 rewardSupplySpeed, uint256 rewardBorrowSpeed)',
          'function rewardSupplySpeeds(uint8 rewardType, address cToken) external view returns (uint)',
        ], rewardAdmin);

        cNEAR = new ethers.Contract(network_.Bastion.cNEAR, ERC20_ABI, deployer);
        BSTN = new ethers.Contract('0x9f1F933C660a1DC856F0E0Fe058435879c5CCEf0', ERC20_ABI, deployer);
      });

      it("Yield on L2 vault", async () => {
        await usdt.transfer(a1.address, getUsdtAmount('5000'));
        await usdt.connect(a1).approve(vault.address, getUsdtAmount('5000'));

        const WNEARVault = new ethers.Contract(await strategy.WNEARVault(), l2VaultArtifact.abi, a1);
        await WNEARVault.connect(deployer).setAdmin(admin.address);

        await rewardDistributor._setRewardSpeed(0, network_.Bastion.cNEAR, 0, 0);
        var ret = await vault.getEachPoolInUSD();
        var tokens = ret[1];
        await vault.connect(admin).depositByAdmin(a1.address, tokens, [getUsdtAmount('5000')], 1);

        await increaseTime(DAY);
        expect(await WNEARVault.getPendingRewards()).equal(0);

        const balanceBefore = await cNEAR.balanceOf(WNEARVault.address);
        const aprBefore = await WNEARVault.getAPR();
        expect(await BSTN.balanceOf(common.treasury)).equal(0);
        await rewardDistributor._setRewardSpeed(0, network_.Bastion.cNEAR, parseEther('0.1'), 0);
        expect(await WNEARVault.getAPR()).gt(aprBefore);

        await increaseTime(DAY);
        expect(await WNEARVault.getPendingRewards()).gt(0);
        await WNEARVault.connect(admin).yield();
        expect(await WNEARVault.getPendingRewards()).equal(0);
        expect(await cNEAR.balanceOf(WNEARVault.address)).gt(balanceBefore);
        expect(await BSTN.balanceOf(WNEARVault.address)).equal(0);
        expect(await BSTN.balanceOf(common.treasury)).gt(0);
      });
    });
});