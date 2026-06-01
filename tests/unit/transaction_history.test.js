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
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const transaction_service_1 = require("../../src/Gateway/transaction.service");
const Datasource_1 = __importDefault(require("../../src/config/Datasource"));
const user_entity_1 = require("../../src/Auth/user.entity");
// Mock the Stellar SDK
jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      transactions: jest.fn().mockReturnThis(),
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "tx1",
            hash: "hash1",
            ledger: 12345,
            created_at: "2024-01-15T10:00:00Z",
            source_account: "GD77MOCKPUBLICKEY1234567890",
            fee_paid: 100,
            operation_count: 1,
            successful: true,
            memo_type: "none",
            memo: null,
            paging_token: "cursor1",
            operations: [
              {
                id: "op1",
                type: "payment",
                source_account: "GD77MOCKPUBLICKEY1234567890",
                created_at: "2024-01-15T10:00:00Z",
                transaction_hash: "hash1",
                from: "GD77MOCKPUBLICKEY1234567890",
                to: "GDANOTHERPUBLICKEY1234567890",
                amount: "100.0000000",
                asset_type: "native",
              },
            ],
          },
        ],
      }),
      effects: jest.fn().mockReturnThis(),
      forTransaction: jest.fn().mockReturnThis(),
    })),
  },
}));
// Mock the database
jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn().mockReturnValue({
      findOne: jest.fn(),
    }),
  },
}));
describe("TransactionHistoryService", () => {
  let service;
  let mockUserRepository;
  beforeEach(() => {
    service = new transaction_service_1.TransactionHistoryService();
    mockUserRepository = Datasource_1.default.getRepository(user_entity_1.User);
    jest.clearAllMocks();
  });
  describe("getTransactionHistory", () => {
    it("should return transaction history for a valid user", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user1",
          name: "testuser",
          address: "GD77MOCKPUBLICKEY1234567890",
          pk: "SABC...MOCKSECRET",
          isDeployed: false,
          isFunded: true,
          tokenType: "STRK",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        const result = yield service.getTransactionHistory("user1", {});
        expect(result).toBeDefined();
        expect(result.transactions).toBeDefined();
        expect(result.pagination).toBeDefined();
        expect(result.pagination.limit).toBe(20);
      }));
    it("should throw error for non-existent user", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockUserRepository.findOne.mockResolvedValue(null);
        yield expect(
          service.getTransactionHistory("nonexistent", {})
        ).rejects.toThrow("User not found");
      }));
    it("should apply type filter", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user1",
          name: "testuser",
          address: "GD77MOCKPUBLICKEY1234567890",
          pk: "SABC...MOCKSECRET",
          isDeployed: false,
          isFunded: true,
          tokenType: "STRK",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        const result = yield service.getTransactionHistory("user1", {
          type: "transfer",
        });
        expect(result.transactions).toBeDefined();
      }));
    it("should apply date range filter", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user1",
          name: "testuser",
          address: "GD77MOCKPUBLICKEY1234567890",
          pk: "SABC...MOCKSECRET",
          isDeployed: false,
          isFunded: true,
          tokenType: "STRK",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        const result = yield service.getTransactionHistory("user1", {
          startDate: "2024-01-01T00:00:00Z",
          endDate: "2024-12-31T23:59:59Z",
        });
        expect(result.transactions).toBeDefined();
      }));
    it("should respect custom limit", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user1",
          name: "testuser",
          address: "GD77MOCKPUBLICKEY1234567890",
          pk: "SABC...MOCKSECRET",
          isDeployed: false,
          isFunded: true,
          tokenType: "STRK",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        const result = yield service.getTransactionHistory("user1", {
          limit: 50,
        });
        expect(result.pagination.limit).toBe(50);
      }));
    it("should throw error for limit > 100", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user1",
          name: "testuser",
          address: "GD77MOCKPUBLICKEY1234567890",
          pk: "SABC...MOCKSECRET",
          isDeployed: false,
          isFunded: true,
          tokenType: "STRK",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        yield expect(
          service.getTransactionHistory("user1", { limit: 150 })
        ).rejects.toThrow("Limit cannot exceed 100");
      }));
    it("should cache results for 30 seconds", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user1",
          name: "testuser",
          address: "GD77MOCKPUBLICKEY1234567890",
          pk: "SABC...MOCKSECRET",
          isDeployed: false,
          isFunded: true,
          tokenType: "STRK",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        // First call
        const result1 = yield service.getTransactionHistory("user1", {});
        // Second call should use cache
        const result2 = yield service.getTransactionHistory("user1", {});
        expect(result1).toEqual(result2);
        // Should only call findOne once due to caching
        expect(mockUserRepository.findOne).toHaveBeenCalledTimes(1);
      }));
  });
  describe("determineTransactionType", () => {
    it("should identify funding transactions", () => {
      const operations = [
        {
          type: "create_account",
          source_account: "GD77MOCKPUBLICKEY1234567890",
          created_at: "2024-01-15T10:00:00Z",
          transaction_hash: "hash1",
          starting_balance: "100.0000000",
        },
      ];
      const type = service.determineTransactionType(operations);
      expect(type).toBe("funding");
    });
    it("should identify swap transactions", () => {
      const operations = [
        {
          type: "path_payment_strict_send",
          source_account: "GD77MOCKPUBLICKEY1234567890",
          created_at: "2024-01-15T10:00:00Z",
          transaction_hash: "hash1",
          amount: "100.0000000",
        },
      ];
      const type = service.determineTransactionType(operations);
      expect(type).toBe("swap");
    });
    it("should identify transfer transactions", () => {
      const operations = [
        {
          type: "payment",
          source_account: "GD77MOCKPUBLICKEY1234567890",
          created_at: "2024-01-15T10:00:00Z",
          transaction_hash: "hash1",
          from: "GD77MOCKPUBLICKEY1234567890",
          to: "GDANOTHERPUBLICKEY1234567890",
          amount: "100.0000000",
        },
      ];
      const type = service.determineTransactionType(operations);
      expect(type).toBe("transfer");
    });
    it("should identify deployment transactions", () => {
      const operations = [
        {
          type: "manage_data",
          source_account: "GD77MOCKPUBLICKEY1234567890",
          created_at: "2024-01-15T10:00:00Z",
          transaction_hash: "hash1",
          name: "deployment",
          value: "deployed",
        },
      ];
      const type = service.determineTransactionType(operations);
      expect(type).toBe("deployment");
    });
  });
});
