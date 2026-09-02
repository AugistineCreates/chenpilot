/* eslint-disable @typescript-eslint/no-explicit-any */
// chenpilot/tests/stellar.mock.ts
import { jest } from "@jest/globals";

export const mockStellarSdk: Record<string, any> = {
  Keypair: {
    random: jest.fn(() => ({
      publicKey: () => "GD77MOCKPUBLICKEY1234567890",
      secret: () => "SABC...MOCKSECRET",
    })),
    fromSecret: jest.fn(() => ({
      publicKey: () => "GD77MOCKPUBLICKEY1234567890",
      sign: jest.fn().mockReturnValue(Buffer.from("mock_signature")),
    })),
  },
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: (jest.fn() as any).mockResolvedValue({
        id: "GD77MOCKPUBLICKEY1234567890",
        balances: [
          { asset_type: "native", balance: "100.0000" },
          { asset_code: "USDC", balance: "50.00" },
        ],
        sequenceNumber: () => "12345",
      }),
      submitTransaction: (jest.fn() as any).mockResolvedValue({
        hash: "mock_hash_123",
        ledger: 45678,
      }),
      strictReceivePaths: jest.fn().mockImplementation(() => ({
        call: (jest.fn() as any).mockResolvedValue({
          records: [{ source_amount: "10.00", source_asset_type: "native" }],
        }),
      })),
    })),
  },
  // Fixed: Removed the duplicate "Asset:" key and the Record type hint
  Asset: function (this: any, code: string, issuer: string) {
    this.code = code;
    this.issuer = issuer;
    this.isNative = () => !code;
  },
  Memo: {
    text: jest.fn((t: string) => ({ type: "text", value: t })),
    id: jest.fn((id: string) => ({ type: "id", value: id })),
    hash: jest.fn((h: string) => ({ type: "hash", value: h })),
    none: jest.fn(() => ({ type: "none" })),
  },
  TransactionBuilder: Object.assign(
    jest.fn().mockImplementation(() => {
      const mockTx = {
        type: "mock_tx",
        sign: jest.fn().mockReturnThis(),
        toEnvelope: jest.fn().mockReturnValue({
          toXDR: jest.fn().mockReturnValue("mock_base64_xdr_envelope"),
        }),
      };
      return {
        addOperation: jest.fn().mockReturnThis(),
        addMemo: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
        build: jest.fn().mockReturnValue(mockTx),
        sign: jest.fn().mockReturnThis(),
      };
    }),
    {
      cloneFrom: jest.fn().mockImplementation(() => {
        const mockTx = {
          type: "mock_tx",
          sign: jest.fn().mockReturnThis(),
          toEnvelope: jest.fn().mockReturnValue({
            toXDR: jest.fn().mockReturnValue("mock_base64_xdr_envelope"),
          }),
        };
        return {
          addOperation: jest.fn().mockReturnThis(),
          addMemo: jest.fn().mockReturnThis(),
          setTimeout: jest.fn().mockReturnThis(),
          build: jest.fn().mockReturnValue(mockTx),
        };
      }),
      fromXDR: jest.fn(),
    }
  ),
  Operation: {
    payment: jest.fn().mockReturnValue({ type: "payment" }),
    changeTrust: jest.fn().mockReturnValue({ type: "changeTrust" }),
    pathPaymentStrictReceive: jest
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
  Account: jest.fn().mockImplementation((accountId: any, sequence: any) => ({
    accountId,
    sequence,
  })),
  Contract: jest.fn().mockImplementation((contractId: any) => ({
    contractId,
    call: jest.fn((method: string, ...args: any[]) => ({
      type: "invoke",
      contractId,
      method,
      args,
    })),
  })),
  SorobanRpc: {
    Server: jest.fn().mockImplementation(() => ({
      simulateTransaction: (jest.fn() as any).mockResolvedValue({
        result: { retval: "mock_scval" },
      }),
    })),
    assembleTransaction: jest.fn((tx: any) => tx),
  },
  scValToNative: jest.fn((val: any) => val),
  nativeToScVal: jest.fn((val: any) => val),
};

// Fixed: Only need to mock each package once
jest.mock("@stellar/stellar-sdk", () => mockStellarSdk);
jest.mock("stellar-sdk", () => mockStellarSdk);
