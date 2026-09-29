import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

jest.mock("../../src/services/stellarPrice.service", () => ({
  __esModule: true,
  default: {
    getPrice: jest.fn().mockResolvedValue({
      price: 1,
      estimatedOutput: 1,
      cached: false,
      path: [],
    }),
  },
}));

jest.mock("../../src/services/flashSwapRiskAnalyzer", () => ({
  flashSwapRiskAnalyzer: {
    analyzeSwapRisk: jest.fn().mockResolvedValue({
      riskLevel: "low",
      sandwichAttackRisk: 0,
      warnings: [],
      recommendations: [],
    }),
  },
}));

jest.mock("../../src/Auth/accountSecretStore", () => ({
  accountSecretStore: {
    getAccountByUserId: jest.fn(() => ({
      secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    })),
  },
}));

jest.mock("../../src/transactions/TransactionLifecycle.service", () => ({
  transactionLifecycleService: {
    create: jest.fn().mockResolvedValue({ id: "lifecycle-1" }),
    transition: jest.fn().mockResolvedValue({}),
    fail: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("../../src/services/lock", () => ({
  RedisLockService: jest.fn().mockImplementation(() => ({
    acquireLock: jest
      .fn()
      .mockResolvedValue({
        acquired: true,
        lockKey: "lock:test",
        lockValue: "test",
      }),
    releaseLock: jest.fn().mockResolvedValue(true),
    extendLock: jest.fn().mockResolvedValue(true),
    isLocked: jest.fn().mockResolvedValue(false),
    getLockInfo: jest.fn().mockResolvedValue(null),
    forceReleaseLock: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  Asset: class {
    constructor(
      public code: string,
      public issuer?: string
    ) {}
    static native() {
      return new (this as unknown as {
        new (code: string, issuer?: string): unknown;
      })("XLM");
    }
  },
  Horizon: { Server: class {} },
  TransactionBuilder: class {
    constructor() {}
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { sign: jest.fn() };
    }
  },
  Operation: { pathPaymentStrictSend: jest.fn(() => ({})) },
  BASE_FEE: "100",
}));

import { SwapTool } from "../../src/Agents/tools/swap";
import { transactionLifecycleService } from "../../src/transactions/TransactionLifecycle.service";

describe("SwapTool lock heartbeat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("extends the trade lock while a swap is still executing", async () => {
    const tool = new SwapTool();
    const lockService = (
      tool as unknown as {
        lockService: {
          acquireLock: jest.Mock;
          extendLock: jest.Mock;
          releaseLock: jest.Mock;
        };
      }
    ).lockService;

    jest.spyOn(lockService, "acquireLock").mockResolvedValue({
      acquired: true,
      lockKey: "trade:user-1",
      lockValue: "user-1:abc",
    });
    const extendSpy = jest
      .spyOn(lockService, "extendLock")
      .mockResolvedValue(true);
    jest.spyOn(lockService, "releaseLock").mockResolvedValue(true);

    jest.spyOn(transactionLifecycleService, "create").mockResolvedValue({
      id: "lifecycle-1",
    } as never);
    jest
      .spyOn(transactionLifecycleService, "fail")
      .mockResolvedValue(undefined as never);

    const result = await tool.execute(
      { from: "XLM", to: "XLM", amount: 10 },
      "user-1"
    );

    expect(result).toBeDefined();
    expect(extendSpy).toHaveBeenCalledWith("trade:user-1", "user-1", 300000);
  });
});
