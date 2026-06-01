"use strict";
/**
 * Unit tests for Recovery Engine
 * Tests retry logic, refund handling, and error recovery scenarios
 */
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
const recovery_1 = require("../recovery");
const types_1 = require("../types");
describe("RecoveryEngine", () => {
  let mockRetryHandler;
  let mockRefundHandler;
  let recoveryContext;
  beforeEach(() => {
    jest.clearAllMocks();
    mockRetryHandler = {
      retryMint: jest.fn(),
    };
    mockRefundHandler = {
      refundLock: jest.fn(),
    };
    recoveryContext = {
      lockTxId: "btc_tx_123",
      mintTxId: "stellar_tx_456",
      amount: "1000",
      fromChain: types_1.ChainId.BITCOIN,
      toChain: types_1.ChainId.STELLAR,
      destinationAddress: "GADDR123",
      lockDetails: {
        scriptHash: "abc123",
        timestamp: 1234567890,
      },
      metadata: {
        userId: "user_1",
      },
    };
  });
  describe("Constructor", () => {
    it("should create engine with default options", () => {
      const engine = new recovery_1.RecoveryEngine();
      expect(engine).toBeInstanceOf(recovery_1.RecoveryEngine);
    });
    it("should create engine with custom options", () => {
      const engine = new recovery_1.RecoveryEngine({
        maxRetries: 5,
        retryDelayMs: 3000,
        retryHandler: mockRetryHandler,
        refundHandler: mockRefundHandler,
      });
      expect(engine).toBeInstanceOf(recovery_1.RecoveryEngine);
    });
  });
  describe("Retry Success Scenarios", () => {
    it("should succeed on first retry attempt", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRetryHandler.retryMint.mockResolvedValueOnce({
          actionTaken: types_1.RecoveryAction.RETRY_MINT,
          success: true,
          message: "Mint succeeded",
          details: { txHash: "new_tx_789" },
        });
        const engine = new recovery_1.RecoveryEngine({
          maxRetries: 3,
          retryDelayMs: 100,
          retryHandler: mockRetryHandler,
        });
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(true);
        expect(result.actionTaken).toBe(types_1.RecoveryAction.RETRY_MINT);
        expect(result.message).toContain("attempt 1");
        expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(1);
      }));
    it("should succeed on second retry attempt", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRetryHandler.retryMint
          .mockResolvedValueOnce({
            actionTaken: types_1.RecoveryAction.RETRY_MINT,
            success: false,
          })
          .mockResolvedValueOnce({
            actionTaken: types_1.RecoveryAction.RETRY_MINT,
            success: true,
            message: "Mint succeeded",
          });
        const engine = new recovery_1.RecoveryEngine({
          maxRetries: 3,
          retryDelayMs: 100,
          retryHandler: mockRetryHandler,
        });
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(true);
        expect(result.message).toContain("attempt 2");
        expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(2);
      }));
    it("should succeed on last retry attempt", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRetryHandler.retryMint
          .mockResolvedValueOnce({
            actionTaken: types_1.RecoveryAction.RETRY_MINT,
            success: false,
          })
          .mockResolvedValueOnce({
            actionTaken: types_1.RecoveryAction.RETRY_MINT,
            success: false,
          })
          .mockResolvedValueOnce({
            actionTaken: types_1.RecoveryAction.RETRY_MINT,
            success: true,
          });
        const engine = new recovery_1.RecoveryEngine({
          maxRetries: 3,
          retryDelayMs: 100,
          retryHandler: mockRetryHandler,
        });
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(true);
        expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(3);
      }));
  });
  describe("Retry Failure and Refund", () => {
    it("should proceed to refund after all retries fail", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRetryHandler.retryMint.mockResolvedValue({
          actionTaken: types_1.RecoveryAction.RETRY_MINT,
          success: false,
        });
        mockRefundHandler.refundLock.mockResolvedValueOnce({
          actionTaken: types_1.RecoveryAction.REFUND_LOCK,
          success: true,
          message: "Refund successful",
        });
        const engine = new recovery_1.RecoveryEngine({
          maxRetries: 3,
          retryDelayMs: 100,
          retryHandler: mockRetryHandler,
          refundHandler: mockRefundHandler,
        });
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(true);
        expect(result.actionTaken).toBe(types_1.RecoveryAction.REFUND_LOCK);
        expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(3);
        expect(mockRefundHandler.refundLock).toHaveBeenCalledTimes(1);
      }));
    it("should handle retry handler throwing errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRetryHandler.retryMint.mockRejectedValue(
          new Error("Network error")
        );
        mockRefundHandler.refundLock.mockResolvedValueOnce({
          actionTaken: types_1.RecoveryAction.REFUND_LOCK,
          success: true,
        });
        const engine = new recovery_1.RecoveryEngine({
          maxRetries: 3,
          retryDelayMs: 100,
          retryHandler: mockRetryHandler,
          refundHandler: mockRefundHandler,
        });
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(true);
        expect(result.actionTaken).toBe(types_1.RecoveryAction.REFUND_LOCK);
        expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(3);
      }));
  });
  describe("Refund Scenarios", () => {
    it("should execute refund when no retry handler provided", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRefundHandler.refundLock.mockResolvedValueOnce({
          actionTaken: types_1.RecoveryAction.REFUND_LOCK,
          success: true,
          message: "Refund executed",
        });
        const engine = new recovery_1.RecoveryEngine({
          refundHandler: mockRefundHandler,
        });
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(true);
        expect(result.actionTaken).toBe(types_1.RecoveryAction.REFUND_LOCK);
        expect(mockRefundHandler.refundLock).toHaveBeenCalledWith(
          recoveryContext
        );
      }));
    it("should handle refund failure", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRefundHandler.refundLock.mockResolvedValueOnce({
          actionTaken: types_1.RecoveryAction.REFUND_LOCK,
          success: false,
          message: "Refund failed",
        });
        const engine = new recovery_1.RecoveryEngine({
          refundHandler: mockRefundHandler,
        });
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(false);
        expect(result.actionTaken).toBe(
          types_1.RecoveryAction.MANUAL_INTERVENTION
        );
        expect(result.message).toContain(
          "Refund handler executed but reported failure"
        );
      }));
    it("should handle refund handler throwing error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRefundHandler.refundLock.mockRejectedValueOnce(
          new Error("Refund error")
        );
        const engine = new recovery_1.RecoveryEngine({
          refundHandler: mockRefundHandler,
        });
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(false);
        expect(result.actionTaken).toBe(
          types_1.RecoveryAction.MANUAL_INTERVENTION
        );
        expect(result.message).toContain("Refund handler threw an error");
      }));
  });
  describe("Manual Intervention", () => {
    it("should require manual intervention when no handlers provided", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const engine = new recovery_1.RecoveryEngine();
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(false);
        expect(result.actionTaken).toBe(
          types_1.RecoveryAction.MANUAL_INTERVENTION
        );
        expect(result.message).toContain(
          "No retry or refund handlers configured"
        );
      }));
    it("should require manual intervention when retry fails and no refund handler", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRetryHandler.retryMint.mockResolvedValue({
          actionTaken: types_1.RecoveryAction.RETRY_MINT,
          success: false,
        });
        const engine = new recovery_1.RecoveryEngine({
          maxRetries: 2,
          retryDelayMs: 100,
          retryHandler: mockRetryHandler,
        });
        const result = yield engine.cleanup(recoveryContext);
        expect(result.success).toBe(false);
        expect(result.actionTaken).toBe(
          types_1.RecoveryAction.MANUAL_INTERVENTION
        );
      }));
  });
  describe("Context Preservation", () => {
    it("should pass complete context to retry handler", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRetryHandler.retryMint.mockResolvedValue({
          actionTaken: types_1.RecoveryAction.RETRY_MINT,
          success: true,
        });
        const engine = new recovery_1.RecoveryEngine({
          retryHandler: mockRetryHandler,
        });
        yield engine.cleanup(recoveryContext);
        expect(mockRetryHandler.retryMint).toHaveBeenCalledWith(
          expect.objectContaining({
            lockTxId: "btc_tx_123",
            amount: "1000",
            fromChain: types_1.ChainId.BITCOIN,
            toChain: types_1.ChainId.STELLAR,
          })
        );
      }));
    it("should pass complete context to refund handler", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockRefundHandler.refundLock.mockResolvedValue({
          actionTaken: types_1.RecoveryAction.REFUND_LOCK,
          success: true,
        });
        const engine = new recovery_1.RecoveryEngine({
          refundHandler: mockRefundHandler,
        });
        yield engine.cleanup(recoveryContext);
        expect(mockRefundHandler.refundLock).toHaveBeenCalledWith(
          recoveryContext
        );
      }));
  });
});
describe("createRecoveryEngine", () => {
  it("should create engine with factory function", () => {
    const engine = (0, recovery_1.createRecoveryEngine)();
    expect(engine).toBeInstanceOf(recovery_1.RecoveryEngine);
  });
  it("should create engine with options", () => {
    const engine = (0, recovery_1.createRecoveryEngine)({
      maxRetries: 5,
      retryDelayMs: 3000,
    });
    expect(engine).toBeInstanceOf(recovery_1.RecoveryEngine);
  });
});
