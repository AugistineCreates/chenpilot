/**
 * Fixed deterministic datasets and mocks for performance benchmarking.
 * All critical execution paths use these fixed fixtures to ensure
 * zero external dependencies, deterministic repeatability, and
 * reproducible latency/allocation measurements.
 */

import * as StellarSdk from "@stellar/stellar-sdk";

// ─── 1. Planning Datasets ───────────────────────────────────────────────────

export const PLANNING_DATASETS = {
  simple: {
    userId: "bench-user-1",
    userInput: "Check my XLM balance",
    mockLLMResponse: {
      workflow: [
        {
          action: "get_balance",
          payload: { asset: "XLM" },
        },
      ],
    },
  },
  sorobanIntent: {
    userId: "bench-user-2",
    userInput: "swap 100 XLM to USDC",
    mockLLMResponse: {
      workflow: [
        {
          action: "swap_tool",
          payload: { from: "XLM", to: "USDC", amount: 100 },
        },
      ],
    },
  },
  complex: {
    userId: "bench-user-3",
    userInput:
      "Swap 500 XLM to USDC, stake 200 USDC into yield vault, and notify ops channel",
    mockLLMResponse: {
      workflow: [
        { action: "get_balance", payload: { asset: "XLM" } },
        {
          action: "swap_tool",
          payload: { from: "XLM", to: "USDC", amount: 500 },
        },
        {
          action: "yield_stake",
          payload: { asset: "USDC", amount: 200, poolId: "vault-pool-1" },
        },
        {
          action: "notify_channel",
          payload: { channel: "ops", message: "Stake completed" },
        },
      ],
    },
  },
  planForOptimization: {
    planId: "bench-opt-plan",
    steps: [
      {
        stepNumber: 1,
        action: "get_balance",
        payload: { asset: "XLM" },
        description: "Fetch initial balance",
      },
      {
        stepNumber: 2,
        action: "swap_tool",
        payload: { from: "XLM", to: "USDC", amount: 100 },
        description: "Execute token swap",
      },
      {
        stepNumber: 3,
        action: "transfer",
        payload: { to: "GBENCHRECIPIENT1234567890", amount: 50, asset: "USDC" },
        description: "Transfer funds to recipient",
      },
    ],
    totalSteps: 3,
    estimatedDuration: 6000,
    riskLevel: "medium" as const,
    requiresApproval: false,
    summary: "Plan for optimization benchmark",
  },
  planForValidation: {
    planId: "bench-val-plan",
    steps: Array.from({ length: 8 }, (_, i) => ({
      stepNumber: i + 1,
      action: `step_action_${i + 1}`,
      payload: { index: i, param: `val-${i}` },
      description: `Validation benchmark step ${i + 1}`,
    })),
    totalSteps: 8,
    estimatedDuration: 24000,
    riskLevel: "medium" as const,
    requiresApproval: true,
    summary: "Plan for validation benchmark",
  },
};

// ─── 2. Simulation Datasets ─────────────────────────────────────────────────

export const SIMULATION_DATASETS = {
  simpleContractCall: {
    network: "testnet" as const,
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    method: "balance",
    args: ["GBENCHMARKACCOUNT1234567890123456789012345678901234567890"],
    sourcePublicKey:
      "GBENCHMARKACCOUNT1234567890123456789012345678901234567890",
  },
  complexContractCall: {
    network: "testnet" as const,
    contractId: "CBENCHMARKCONTRACT123456789012345678901234567890123456789",
    method: "swap_exact_in",
    args: [
      "100000000",
      "95000000",
      [
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBE4PQ",
      ],
      "GBENCHMARKACCOUNT1234567890123456789012345678901234567890",
      "1725000000",
    ],
    sourcePublicKey:
      "GBENCHMARKACCOUNT1234567890123456789012345678901234567890",
  },
  mockRpcSimulationSuccess: {
    id: "sim-12345",
    result: {
      retval: StellarSdk.nativeToScVal(1500000000n, { type: "i128" }),
      auth: [
        {
          credentials: { type: "sourceAccount" },
          rootInvocation: {
            subInvocations: [],
            function: {
              contractAddress:
                "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
              functionName: "balance",
              args: [],
            },
          },
        },
      ],
    },
    minResourceFee: "150",
    transactionData: {
      build: () => ({
        resources: () => ({
          instructions: () => 350000n,
          readBytes: () => 4096n,
        }),
      }),
      toXDR: () => "AAAAAQAAAAAAAAAAAAAA...",
    },
    latestLedger: 123456,
  },
  simulationEngineRequest: {
    userId: "bench-sim-user",
    service: "soroban" as const,
    operation: "invoke",
    parameters: {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      method: "swap",
      amount: "1000",
    },
    seed: 42,
  },
};

// ─── 3. Decoding Datasets ───────────────────────────────────────────────────

export const DECODING_DATASETS = {
  primitives: {
    i32: StellarSdk.nativeToScVal(123456, { type: "i32" }),
    i64: StellarSdk.nativeToScVal(9876543210n, { type: "i64" }),
    u128: StellarSdk.nativeToScVal(1000000000000000000000n, { type: "u128" }),
    i128: StellarSdk.nativeToScVal(-500000000000000000000n, { type: "i128" }),
    u256: StellarSdk.nativeToScVal(123456789012345678901234567890n, {
      type: "u256",
    }),
    symbol: StellarSdk.nativeToScVal("TRANSFER", { type: "symbol" }),
    string: StellarSdk.nativeToScVal(
      "benchmark-string-value-payload-for-decoding",
      { type: "string" }
    ),
    bool: StellarSdk.nativeToScVal(true, { type: "bool" }),
    address: StellarSdk.nativeToScVal(
      "GBENCHMARKACCOUNT1234567890123456789012345678901234567890",
      { type: "address" }
    ),
  },
  complexNested: StellarSdk.nativeToScVal({
    status: "ok",
    route: [
      { pool: "pool-1", fee: 300, reserve0: 1000000n, reserve1: 2000000n },
      { pool: "pool-2", fee: 500, reserve0: 3000000n, reserve1: 4000000n },
      { pool: "pool-3", fee: 100, reserve0: 5000000n, reserve1: 6000000n },
    ],
    tokens: ["XLM", "USDC", "AQUA", "BTC"],
    amountsIn: [1000000n, 980000n, 960000n],
    amountsOut: [980000n, 960000n, 950000n],
    slippageToleranceBps: 50,
    metadata: {
      executionId: "exec-9999",
      oraclePrices: { XLM: 120000n, USDC: 1000000n, AQUA: 5000n },
      flags: [true, false, true, true],
    },
  }),
  contractEvent: {
    type: "contract" as const,
    ledger: 123456,
    ledgerClosedAt: "2026-08-30T00:00:00Z",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    id: "0000123456-0000000001",
    pagingToken: "123456-1",
    inSuccessfulContractCall: true,
    topic: [
      StellarSdk.nativeToScVal("transfer", { type: "symbol" }),
      StellarSdk.nativeToScVal(
        "GBENCHMARKACCOUNT1234567890123456789012345678901234567890",
        { type: "address" }
      ),
      StellarSdk.nativeToScVal(
        "GBENCHMARKRECIPIENT12345678901234567890123456789012345",
        { type: "address" }
      ),
    ],
    value: StellarSdk.nativeToScVal(5000000000n, { type: "i128" }),
  },
};

// ─── 4. Transaction Construction Datasets ───────────────────────────────────

const testKeypair = StellarSdk.Keypair.random();
export const TRANSACTION_DATASETS = {
  keypair: testKeypair,
  sourceSecret: testKeypair.secret(),
  sourcePublicKey: testKeypair.publicKey(),
  destinationPublicKey:
    "GBENCHMARKRECIPIENT12345678901234567890123456789012345",
  networkPassphrase: StellarSdk.Networks.TESTNET,
  invokeContractParams: {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    method: "transfer",
    args: [
      StellarSdk.nativeToScVal(testKeypair.publicKey(), { type: "address" }),
      StellarSdk.nativeToScVal(
        "GBENCHMARKRECIPIENT12345678901234567890123456789012345",
        { type: "address" }
      ),
      StellarSdk.nativeToScVal(10000000n, { type: "i128" }),
    ],
  },
  multiOperationPayload: {
    paymentAmount: "100.50",
    assetCode: "USDC",
    issuer: "GBENCHMARKISSUER1234567890123456789012345678901234567890",
    trustlineLimit: "1000000",
    memoText: "Bench multi-op transfer",
  },
};
