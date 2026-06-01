"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockStellarSdk = void 0;

// chenpilot/tests/stellar.mock.ts
const globals_1 = require("@jest/globals");
exports.mockStellarSdk = {
  Keypair: {
    random: globals_1.jest.fn(() => ({
      publicKey: () => "GD77MOCKPUBLICKEY1234567890",
      secret: () => "SABC...MOCKSECRET",
    })),
    fromSecret: globals_1.jest.fn(() => ({
      publicKey: () => "GD77MOCKPUBLICKEY1234567890",
      sign: globals_1.jest.fn().mockReturnValue(Buffer.from("mock_signature")),
    })),
  },
  Horizon: {
    Server: globals_1.jest.fn().mockImplementation(() => ({
      loadAccount: globals_1.jest.fn().mockResolvedValue({
        id: "GD77MOCKPUBLICKEY1234567890",
        balances: [
          { asset_type: "native", balance: "100.0000" },
          { asset_code: "USDC", balance: "50.00" },
        ],
        sequenceNumber: () => "12345",
      }),
      submitTransaction: globals_1.jest.fn().mockResolvedValue({
        hash: "mock_hash_123",
        ledger: 45678,
      }),
      strictReceivePaths: globals_1.jest.fn().mockImplementation(() => ({
        call: globals_1.jest.fn().mockResolvedValue({
          records: [{ source_amount: "10.00", source_asset_type: "native" }],
        }),
      })),
    })),
  },
  // Fixed: Removed the duplicate "Asset:" key and the Record type hint
  Asset: function (code, issuer) {
    this.code = code;
    this.issuer = issuer;
    this.isNative = () => !code;
  },
  TransactionBuilder: globals_1.jest.fn().mockImplementation(() => ({
    addOperation: globals_1.jest.fn().mockReturnThis(),
    addMemo: globals_1.jest.fn().mockReturnThis(),
    setTimeout: globals_1.jest.fn().mockReturnThis(),
    build: globals_1.jest.fn().mockReturnValue({ type: "mock_tx" }),
    sign: globals_1.jest.fn().mockReturnThis(),
  })),
  Operation: {
    payment: globals_1.jest.fn().mockReturnValue({ type: "payment" }),
    pathPaymentStrictReceive: globals_1.jest
      .fn()
      .mockReturnValue({ type: "pathPayment" }),
  },
  Network: {
    TESTNET: "Test SDF Network ; September 2015",
  },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  BASE_FEE: "100",
  Account: globals_1.jest.fn().mockImplementation((accountId, sequence) => ({
    accountId,
    sequence,
  })),
  Contract: globals_1.jest.fn().mockImplementation((contractId) => ({
    contractId,
    call: globals_1.jest.fn((method, ...args) => ({
      type: "invoke",
      contractId: args[0],
      method: callArgs[0],
      args: callArgs.slice(1),
    })),
  })),
  SorobanRpc: {
    Server: globals_1.jest.fn().mockImplementation(() => ({
      simulateTransaction: globals_1.jest.fn().mockResolvedValue({
        result: { retval: "mock_scval" },
      }),
    })),
  },
  scValToNative: globals_1.jest.fn((val) => val),
  nativeToScVal: globals_1.jest.fn((val) => val),
};
// Fixed: Only need to mock each package once
globals_1.jest.mock("@stellar/stellar-sdk", () => exports.mockStellarSdk);
globals_1.jest.mock("stellar-sdk", () => exports.mockStellarSdk);
