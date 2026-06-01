"use strict";
/**
 * Mock RPC responses for testing Soroban RPC client
 * Provides realistic mock data for ledger lookups and event queries
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
exports.MockRpcClient =
  exports.mockTimeoutError =
  exports.mockNetworkError =
  exports.mockRpcErrorResponse =
  exports.mockComplexEventTransaction =
  exports.mockFailedTransaction =
  exports.mockMultiEventTransaction =
  exports.mockBurnTransaction =
  exports.mockMintTransaction =
  exports.mockTransferTransaction =
  exports.mockEmptyLedgerResponse =
  exports.mockLedgerResponse =
    void 0;
exports.generateMockLedger = generateMockLedger;
exports.generateMockTransaction = generateMockTransaction;
/**
 * Mock successful ledger response
 */
exports.mockLedgerResponse = {
  id: "ledger_1000000",
  sequence: 1000000,
  hash: "abc123def456",
  previousLedgerHash: "prev_hash_999999",
  closeTime: 1700000000,
  transactionCount: 5,
};
/**
 * Mock ledger with no transactions
 */
exports.mockEmptyLedgerResponse = {
  id: "ledger_1000001",
  sequence: 1000001,
  hash: "empty_ledger_hash",
  previousLedgerHash: "abc123def456",
  closeTime: 1700000005,
  transactionCount: 0,
};
/**
 * Mock transaction with transfer event
 */
exports.mockTransferTransaction = {
  id: "tx_transfer_123",
  hash: "tx_hash_transfer_123",
  ledger: 1000000,
  createdAt: 1700000000,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CABC123",
      topic: ["transfer", "GFROM", "GTO"],
      value: { amount: "1000" },
    },
  ],
};
/**
 * Mock transaction with mint event
 */
exports.mockMintTransaction = {
  id: "tx_mint_456",
  hash: "tx_hash_mint_456",
  ledger: 1000000,
  createdAt: 1700000000,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CDEF456",
      topic: ["mint"],
      value: { recipient: "GADDR", amount: "5000" },
    },
  ],
};
/**
 * Mock transaction with burn event
 */
exports.mockBurnTransaction = {
  id: "tx_burn_789",
  hash: "tx_hash_burn_789",
  ledger: 1000001,
  createdAt: 1700000005,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CABC123",
      topic: ["burn"],
      value: { from: "GADDR", amount: "500" },
    },
  ],
};
/**
 * Mock transaction with multiple events
 */
exports.mockMultiEventTransaction = {
  id: "tx_multi_999",
  hash: "tx_hash_multi_999",
  ledger: 1000002,
  createdAt: 1700000010,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CABC123",
      topic: ["approve"],
      value: { spender: "GSPENDER", amount: "10000" },
    },
    {
      type: "contract",
      contractId: "CABC123",
      topic: ["transfer"],
      value: { from: "GFROM", to: "GTO", amount: "1000" },
    },
  ],
};
/**
 * Mock failed transaction
 */
exports.mockFailedTransaction = {
  id: "tx_failed_111",
  hash: "tx_hash_failed_111",
  ledger: 1000003,
  createdAt: 1700000015,
  status: "FAILED",
  events: [],
};
/**
 * Mock transaction with complex event data
 */
exports.mockComplexEventTransaction = {
  id: "tx_complex_222",
  hash: "tx_hash_complex_222",
  ledger: 1000004,
  createdAt: 1700000020,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CGHI789",
      topic: ["swap_executed"],
      value: {
        trader: "GTRADER",
        tokenIn: "CTOKEN_IN",
        tokenOut: "CTOKEN_OUT",
        amountIn: "1000",
        amountOut: "950",
        fee: "50",
        path: ["CTOKEN_IN", "CTOKEN_MID", "CTOKEN_OUT"],
        timestamp: 1700000020,
      },
    },
  ],
};
/**
 * Mock RPC error response
 */
exports.mockRpcErrorResponse = {
  jsonrpc: "2.0",
  id: 1,
  error: {
    code: -32600,
    message: "Invalid request",
  },
};
/**
 * Mock RPC network error
 */
exports.mockNetworkError = new Error("Network request failed");
/**
 * Mock RPC timeout error
 */
exports.mockTimeoutError = new Error("Request timeout");
/**
 * Generate mock ledger sequence
 */
function generateMockLedger(sequence) {
  return {
    id: `ledger_${sequence}`,
    sequence,
    hash: `hash_${sequence}`,
    previousLedgerHash: `hash_${sequence - 1}`,
    closeTime: 1700000000 + sequence * 5,
    transactionCount: Math.floor(Math.random() * 10),
  };
}
/**
 * Generate mock transaction
 */
function generateMockTransaction(ledger, contractId, topic) {
  return {
    id: `tx_${ledger}_${Math.random().toString(36).substr(2, 9)}`,
    hash: `tx_hash_${Math.random().toString(36).substr(2, 16)}`,
    ledger,
    createdAt: 1700000000 + ledger * 5,
    status: "SUCCESS",
    events: [
      {
        type: "contract",
        contractId,
        topic,
        value: { data: "mock_data" },
      },
    ],
  };
}
/**
 * Mock RPC client for testing
 */
class MockRpcClient {
  constructor() {
    this.ledgers = new Map();
    this.transactions = new Map();
    // Initialize with some default data
    this.ledgers.set(1000000, exports.mockLedgerResponse);
    this.ledgers.set(1000001, exports.mockEmptyLedgerResponse);
    this.transactions.set(
      exports.mockTransferTransaction.hash,
      exports.mockTransferTransaction
    );
    this.transactions.set(
      exports.mockMintTransaction.hash,
      exports.mockMintTransaction
    );
    this.transactions.set(
      exports.mockBurnTransaction.hash,
      exports.mockBurnTransaction
    );
  }
  getLedger(sequence) {
    return __awaiter(this, void 0, void 0, function* () {
      return this.ledgers.get(sequence) || null;
    });
  }
  getTransaction(hash) {
    return __awaiter(this, void 0, void 0, function* () {
      return this.transactions.get(hash) || null;
    });
  }
  getLatestLedger() {
    return __awaiter(this, void 0, void 0, function* () {
      const sequences = Array.from(this.ledgers.keys());
      const latest = Math.max(...sequences);
      return this.ledgers.get(latest);
    });
  }
  addLedger(ledger) {
    this.ledgers.set(ledger.sequence, ledger);
  }
  addTransaction(transaction) {
    this.transactions.set(transaction.hash, transaction);
  }
}
exports.MockRpcClient = MockRpcClient;
