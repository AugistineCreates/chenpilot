import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CoreEngine, IERC20 } from "../../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("CoreEngine Emergency Logic", function () {
  async function deployCoreEngineFixture() {
    const [owner, emergencyAccount, user, otherAccount] =
      await ethers.getSigners();

    // Deploy a mock ERC20 for testing
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = await MockToken.deploy("Mock Token", "MTK", 18);
    await token.waitForDeployment();

    const CoreEngineFactory = await ethers.getContractFactory("CoreEngine");
    const coreEngine = await CoreEngineFactory.deploy();
    await coreEngine.waitForDeployment();

    const EMERGENCY_ROLE = await coreEngine.EMERGENCY_ROLE();
    await coreEngine.grantRole(EMERGENCY_ROLE, emergencyAccount.address);

    return {
      coreEngine,
      token,
      owner,
      emergencyAccount,
      user,
      otherAccount,
      EMERGENCY_ROLE,
    };
  }

  describe("Pause Functionality", function () {
    it("Should allow account with EMERGENCY_ROLE to pause", async function () {
      const { coreEngine, emergencyAccount } = await loadFixture(
        deployCoreEngineFixture
      );
      await expect(coreEngine.connect(emergencyAccount).pause())
        .to.emit(coreEngine, "EmergencyPaused")
        .withArgs(emergencyAccount.address);
      expect(await coreEngine.isEmergencyPaused()).to.be.true;
    });

    it("Should reject pause from unauthorized accounts", async function () {
      const { coreEngine, user } = await loadFixture(deployCoreEngineFixture);
      const EMERGENCY_ROLE = await coreEngine.EMERGENCY_ROLE();
      await expect(coreEngine.connect(user).pause())
        .to.be.revertedWithCustomError(
          coreEngine,
          "AccessControlUnauthorizedAccount"
        )
        .withArgs(user.address, EMERGENCY_ROLE);
    });

    it("Should allow account with EMERGENCY_ROLE to unpause", async function () {
      const { coreEngine, emergencyAccount } = await loadFixture(
        deployCoreEngineFixture
      );
      await coreEngine.connect(emergencyAccount).pause();
      await expect(coreEngine.connect(emergencyAccount).unpause())
        .to.emit(coreEngine, "EmergencyUnpaused")
        .withArgs(emergencyAccount.address);
      expect(await coreEngine.isEmergencyPaused()).to.be.false;
    });
  });

  describe("Gated Functions", function () {
    it("Should reject swap when paused", async function () {
      const { coreEngine, emergencyAccount, user, token } = await loadFixture(
        deployCoreEngineFixture
      );
      await coreEngine.connect(emergencyAccount).pause();

      const tokenAddress = await token.getAddress();
      await expect(
        coreEngine.connect(user).swap(tokenAddress, tokenAddress, 100)
      ).to.be.revertedWithCustomError(coreEngine, "EnforcedPause");
    });

    it("Should reject rebalance when paused", async function () {
      const { coreEngine, emergencyAccount, user, token } = await loadFixture(
        deployCoreEngineFixture
      );
      await coreEngine.connect(emergencyAccount).pause();

      const tokenAddress = await token.getAddress();
      await expect(
        coreEngine.connect(user).rebalance([tokenAddress], [100])
      ).to.be.revertedWithCustomError(coreEngine, "EnforcedPause");
    });
  });

  describe("Emergency Evacuation", function () {
    it("Should track principal correctly and allow withdrawal during pause", async function () {
      const { coreEngine, emergencyAccount, user, token } = await loadFixture(
        deployCoreEngineFixture
      );
      const depositAmount = ethers.parseEther("100");
      const tokenAddress = await token.getAddress();
      const coreEngineAddress = await coreEngine.getAddress();

      // Setup user with tokens and deposit
      await token.mint(user.address, depositAmount);
      await token.connect(user).approve(coreEngineAddress, depositAmount);
      await coreEngine.connect(user).deposit(tokenAddress, depositAmount);

      expect(
        await coreEngine.userPrincipal(user.address, tokenAddress)
      ).to.equal(depositAmount);

      // Pause the contract
      await coreEngine.connect(emergencyAccount).pause();

      // Withdraw principal
      const initialBalance = await token.balanceOf(user.address);
      await expect(coreEngine.connect(user).emergencyWithdraw(tokenAddress))
        .to.emit(coreEngine, "EmergencyWithdrawn")
        .withArgs(user.address, tokenAddress, depositAmount);

      expect(await token.balanceOf(user.address)).to.equal(
        initialBalance + depositAmount
      );
      expect(
        await coreEngine.userPrincipal(user.address, tokenAddress)
      ).to.equal(0);
    });

    it("Should reject emergencyWithdraw when not paused", async function () {
      const { coreEngine, user, token } = await loadFixture(
        deployCoreEngineFixture
      );
      const tokenAddress = await token.getAddress();

      await expect(
        coreEngine.connect(user).emergencyWithdraw(tokenAddress)
      ).to.be.revertedWithCustomError(coreEngine, "ExpectedPause");
    });

    it("Should reject emergencyWithdraw if no principal", async function () {
      const { coreEngine, emergencyAccount, user, token } = await loadFixture(
        deployCoreEngineFixture
      );
      await coreEngine.connect(emergencyAccount).pause();

      const tokenAddress = await token.getAddress();
      await expect(
        coreEngine.connect(user).emergencyWithdraw(tokenAddress)
      ).to.be.revertedWith("No principal to withdraw");
    });
  });
});
