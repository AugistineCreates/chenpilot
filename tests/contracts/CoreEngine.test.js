"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const hardhat_network_helpers_1 = require("@nomicfoundation/hardhat-network-helpers");
describe("CoreEngine Emergency Logic", function () {
  function deployCoreEngineFixture() {
    return __awaiter(this, void 0, void 0, function* () {
      const [owner, emergencyAccount, user, otherAccount] =
        yield hardhat_1.ethers.getSigners();
      // Deploy a mock ERC20 for testing
      const MockToken = yield hardhat_1.ethers.getContractFactory("MockERC20");
      const token = yield MockToken.deploy("Mock Token", "MTK", 18);
      yield token.waitForDeployment();
      const CoreEngineFactory =
        yield hardhat_1.ethers.getContractFactory("CoreEngine");
      const coreEngine = yield CoreEngineFactory.deploy();
      yield coreEngine.waitForDeployment();
      const EMERGENCY_ROLE = yield coreEngine.EMERGENCY_ROLE();
      yield coreEngine.grantRole(EMERGENCY_ROLE, emergencyAccount.address);
      return {
        coreEngine,
        token,
        owner,
        emergencyAccount,
        user,
        otherAccount,
        EMERGENCY_ROLE,
      };
    });
  }
  describe("Pause Functionality", function () {
    it("Should allow account with EMERGENCY_ROLE to pause", function () {
      return __awaiter(this, void 0, void 0, function* () {
        const { coreEngine, emergencyAccount } = yield (0,
        hardhat_network_helpers_1.loadFixture)(deployCoreEngineFixture);
        yield (0, chai_1.expect)(coreEngine.connect(emergencyAccount).pause())
          .to.emit(coreEngine, "EmergencyPaused")
          .withArgs(emergencyAccount.address);
        (0, chai_1.expect)(yield coreEngine.isEmergencyPaused()).to.be.true;
      });
    });
    it("Should reject pause from unauthorized accounts", function () {
      return __awaiter(this, void 0, void 0, function* () {
        const { coreEngine, user } = yield (0,
        hardhat_network_helpers_1.loadFixture)(deployCoreEngineFixture);
        const EMERGENCY_ROLE = yield coreEngine.EMERGENCY_ROLE();
        yield (0, chai_1.expect)(coreEngine.connect(user).pause())
          .to.be.revertedWithCustomError(
            coreEngine,
            "AccessControlUnauthorizedAccount"
          )
          .withArgs(user.address, EMERGENCY_ROLE);
      });
    });
    it("Should allow account with EMERGENCY_ROLE to unpause", function () {
      return __awaiter(this, void 0, void 0, function* () {
        const { coreEngine, emergencyAccount } = yield (0,
        hardhat_network_helpers_1.loadFixture)(deployCoreEngineFixture);
        yield coreEngine.connect(emergencyAccount).pause();
        yield (0, chai_1.expect)(coreEngine.connect(emergencyAccount).unpause())
          .to.emit(coreEngine, "EmergencyUnpaused")
          .withArgs(emergencyAccount.address);
        (0, chai_1.expect)(yield coreEngine.isEmergencyPaused()).to.be.false;
      });
    });
  });
  describe("Gated Functions", function () {
    it("Should reject swap when paused", function () {
      return __awaiter(this, void 0, void 0, function* () {
        const { coreEngine, emergencyAccount, user, token } = yield (0,
        hardhat_network_helpers_1.loadFixture)(deployCoreEngineFixture);
        yield coreEngine.connect(emergencyAccount).pause();
        const tokenAddress = yield token.getAddress();
        yield (0, chai_1.expect)(
          coreEngine.connect(user).swap(tokenAddress, tokenAddress, 100)
        ).to.be.revertedWithCustomError(coreEngine, "EnforcedPause");
      });
    });
    it("Should reject rebalance when paused", function () {
      return __awaiter(this, void 0, void 0, function* () {
        const { coreEngine, emergencyAccount, user, token } = yield (0,
        hardhat_network_helpers_1.loadFixture)(deployCoreEngineFixture);
        yield coreEngine.connect(emergencyAccount).pause();
        const tokenAddress = yield token.getAddress();
        yield (0, chai_1.expect)(
          coreEngine.connect(user).rebalance([tokenAddress], [100])
        ).to.be.revertedWithCustomError(coreEngine, "EnforcedPause");
      });
    });
  });
  describe("Emergency Evacuation", function () {
    it("Should track principal correctly and allow withdrawal during pause", function () {
      return __awaiter(this, void 0, void 0, function* () {
        const { coreEngine, emergencyAccount, user, token } = yield (0,
        hardhat_network_helpers_1.loadFixture)(deployCoreEngineFixture);
        const depositAmount = hardhat_1.ethers.parseEther("100");
        const tokenAddress = yield token.getAddress();
        const coreEngineAddress = yield coreEngine.getAddress();
        // Setup user with tokens and deposit
        yield token.mint(user.address, depositAmount);
        yield token.connect(user).approve(coreEngineAddress, depositAmount);
        yield coreEngine.connect(user).deposit(tokenAddress, depositAmount);
        (0, chai_1.expect)(
          yield coreEngine.userPrincipal(user.address, tokenAddress)
        ).to.equal(depositAmount);
        // Pause the contract
        yield coreEngine.connect(emergencyAccount).pause();
        // Withdraw principal
        const initialBalance = yield token.balanceOf(user.address);
        yield (0, chai_1.expect)(
          coreEngine.connect(user).emergencyWithdraw(tokenAddress)
        )
          .to.emit(coreEngine, "EmergencyWithdrawn")
          .withArgs(user.address, tokenAddress, depositAmount);
        (0, chai_1.expect)(yield token.balanceOf(user.address)).to.equal(
          initialBalance + depositAmount
        );
        (0, chai_1.expect)(
          yield coreEngine.userPrincipal(user.address, tokenAddress)
        ).to.equal(0);
      });
    });
    it("Should reject emergencyWithdraw when not paused", function () {
      return __awaiter(this, void 0, void 0, function* () {
        const { coreEngine, user, token } = yield (0,
        hardhat_network_helpers_1.loadFixture)(deployCoreEngineFixture);
        const tokenAddress = yield token.getAddress();
        yield (0, chai_1.expect)(
          coreEngine.connect(user).emergencyWithdraw(tokenAddress)
        ).to.be.revertedWithCustomError(coreEngine, "ExpectedPause");
      });
    });
    it("Should reject emergencyWithdraw if no principal", function () {
      return __awaiter(this, void 0, void 0, function* () {
        const { coreEngine, emergencyAccount, user, token } = yield (0,
        hardhat_network_helpers_1.loadFixture)(deployCoreEngineFixture);
        yield coreEngine.connect(emergencyAccount).pause();
        const tokenAddress = yield token.getAddress();
        yield (0, chai_1.expect)(
          coreEngine.connect(user).emergencyWithdraw(tokenAddress)
        ).to.be.revertedWith("No principal to withdraw");
      });
    });
  });
});
