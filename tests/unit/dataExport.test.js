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
const DataExportService_1 = require("../../src/services/DataExportService");
const user_entity_1 = require("../../src/Auth/user.entity");
const contact_entity_1 = require("../../src/Contacts/contact.entity");
const refreshToken_entity_1 = require("../../src/Auth/refreshToken.entity");
const memory_1 = require("../../src/Agents/memory/memory");
const Datasource_1 = __importDefault(require("../../src/config/Datasource"));
jest.mock("../../src/config/Datasource");
jest.mock("../../src/Agents/memory/memory");
jest.mock("../../src/config/logger");
describe("DataExportService", () => {
  let dataExportService;
  let mockUserRepository;
  let mockContactRepository;
  let mockRefreshTokenRepository;
  beforeEach(() => {
    mockUserRepository = {
      findOne: jest.fn(),
    };
    mockContactRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    mockRefreshTokenRepository = {
      find: jest.fn(),
    };
    Datasource_1.default.getRepository.mockImplementation((entity) => {
      if (entity === user_entity_1.User) return mockUserRepository;
      if (entity === contact_entity_1.Contact) return mockContactRepository;
      if (entity === refreshToken_entity_1.RefreshToken)
        return mockRefreshTokenRepository;
      return null;
    });
    dataExportService = new DataExportService_1.DataExportService();
  });
  afterEach(() => {
    jest.clearAllMocks();
  });
  describe("exportUserData", () => {
    it("should export complete user profile data", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user-123",
          name: "testuser",
          email: "test@example.com",
          address: "GTEST123ADDRESS",
          tokenType: "XLM",
          role: "user",
          isDeployed: true,
          isFunded: true,
          isEmailVerified: true,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-15"),
        };
        const mockContacts = [
          {
            id: "contact-1",
            name: "Alice",
            address: "GALICE123",
            tokenType: "XLM",
            createdAt: new Date("2024-01-05"),
            updatedAt: new Date("2024-01-05"),
          },
          {
            id: "contact-2",
            name: "Bob",
            address: "GBOB456",
            tokenType: "USDC",
            createdAt: new Date("2024-01-10"),
            updatedAt: new Date("2024-01-10"),
          },
        ];
        const mockSessions = [
          {
            id: "session-1",
            createdAt: new Date("2024-01-01"),
            expiresAt: new Date("2024-02-01"),
            isRevoked: false,
          },
          {
            id: "session-2",
            createdAt: new Date("2024-01-10"),
            expiresAt: new Date("2024-02-10"),
            isRevoked: true,
            revokedReason: "User logout",
          },
        ];
        const mockConversationHistory = [
          "User: Check my balance",
          "Agent: Your balance is 1000 XLM",
          "User: Swap 100 XLM to USDC",
        ];
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue(mockContacts);
        mockRefreshTokenRepository.find.mockResolvedValue(mockSessions);
        memory_1.memoryStore.get.mockReturnValue(mockConversationHistory);
        const result = yield dataExportService.exportUserData("user-123");
        expect(result).toBeDefined();
        expect(result.exportMetadata.userId).toBe("user-123");
        expect(result.exportMetadata.exportVersion).toBe("1.0.0");
        expect(result.profile.id).toBe("user-123");
        expect(result.profile.name).toBe("testuser");
        expect(result.profile.email).toBe("test@example.com");
        expect(result.contacts).toHaveLength(2);
        expect(result.conversationHistory.totalEntries).toBe(3);
        expect(result.sessions).toHaveLength(2);
        expect(result.statistics.totalContacts).toBe(2);
        expect(result.statistics.totalSessions).toBe(2);
        expect(result.statistics.totalConversationEntries).toBe(3);
      }));
    it("should handle user with no contacts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user-123",
          name: "testuser",
          address: "GTEST123",
          tokenType: "XLM",
          role: "user",
          isDeployed: false,
          isFunded: false,
          isEmailVerified: false,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue([]);
        mockRefreshTokenRepository.find.mockResolvedValue([]);
        memory_1.memoryStore.get.mockReturnValue([]);
        const result = yield dataExportService.exportUserData("user-123");
        expect(result.contacts).toHaveLength(0);
        expect(result.statistics.totalContacts).toBe(0);
        expect(result.conversationHistory.totalEntries).toBe(0);
      }));
    it("should throw error when user not found", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockUserRepository.findOne.mockResolvedValue(null);
        yield expect(
          dataExportService.exportUserData("nonexistent-user")
        ).rejects.toThrow("User not found");
      }));
    it("should calculate account age correctly", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user-123",
          name: "testuser",
          address: "GTEST123",
          tokenType: "XLM",
          role: "user",
          isDeployed: false,
          isFunded: false,
          isEmailVerified: false,
          createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
          updatedAt: new Date(),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue([]);
        mockRefreshTokenRepository.find.mockResolvedValue([]);
        memory_1.memoryStore.get.mockReturnValue([]);
        const result = yield dataExportService.exportUserData("user-123");
        expect(result.statistics.accountAge).toContain("month");
      }));
    it("should sanitize sensitive data (no private keys)", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user-123",
          name: "testuser",
          address: "GTEST123",
          pk: "SECRET_PRIVATE_KEY",
          encryptedPrivateKey: "ENCRYPTED_KEY",
          tokenType: "XLM",
          role: "user",
          isDeployed: false,
          isFunded: false,
          isEmailVerified: false,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue([]);
        mockRefreshTokenRepository.find.mockResolvedValue([]);
        memory_1.memoryStore.get.mockReturnValue([]);
        const result = yield dataExportService.exportUserData("user-123");
        const jsonString = JSON.stringify(result);
        expect(jsonString).not.toContain("SECRET_PRIVATE_KEY");
        expect(jsonString).not.toContain("ENCRYPTED_KEY");
        expect(jsonString).not.toContain("pk");
        expect(jsonString).not.toContain("encryptedPrivateKey");
      }));
    it("should include session revocation details", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user-123",
          name: "testuser",
          address: "GTEST123",
          tokenType: "XLM",
          role: "user",
          isDeployed: false,
          isFunded: false,
          isEmailVerified: false,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        };
        const mockSessions = [
          {
            id: "session-1",
            createdAt: new Date("2024-01-01"),
            expiresAt: new Date("2024-02-01"),
            isRevoked: true,
            revokedReason: "Security breach",
          },
        ];
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue([]);
        mockRefreshTokenRepository.find.mockResolvedValue(mockSessions);
        memory_1.memoryStore.get.mockReturnValue([]);
        const result = yield dataExportService.exportUserData("user-123");
        expect(result.sessions[0].isRevoked).toBe(true);
        expect(result.sessions[0].revokedReason).toBe("Security breach");
      }));
  });
  describe("exportUserDataAsJSON", () => {
    it("should return formatted JSON string", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user-123",
          name: "testuser",
          address: "GTEST123",
          tokenType: "XLM",
          role: "user",
          isDeployed: false,
          isFunded: false,
          isEmailVerified: false,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue([]);
        mockRefreshTokenRepository.find.mockResolvedValue([]);
        memory_1.memoryStore.get.mockReturnValue([]);
        const jsonString =
          yield dataExportService.exportUserDataAsJSON("user-123");
        expect(typeof jsonString).toBe("string");
        expect(() => JSON.parse(jsonString)).not.toThrow();
        const parsed = JSON.parse(jsonString);
        expect(parsed.exportMetadata).toBeDefined();
        expect(parsed.profile).toBeDefined();
        expect(parsed.contacts).toBeDefined();
      }));
    it("should format JSON with proper indentation", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user-123",
          name: "testuser",
          address: "GTEST123",
          tokenType: "XLM",
          role: "user",
          isDeployed: false,
          isFunded: false,
          isEmailVerified: false,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue([]);
        mockRefreshTokenRepository.find.mockResolvedValue([]);
        memory_1.memoryStore.get.mockReturnValue([]);
        const jsonString =
          yield dataExportService.exportUserDataAsJSON("user-123");
        expect(jsonString).toContain("\n");
        expect(jsonString).toContain("  ");
      }));
  });
  describe("exportUserDataAsBuffer", () => {
    it("should return Buffer with UTF-8 encoding", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user-123",
          name: "testuser",
          address: "GTEST123",
          tokenType: "XLM",
          role: "user",
          isDeployed: false,
          isFunded: false,
          isEmailVerified: false,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue([]);
        mockRefreshTokenRepository.find.mockResolvedValue([]);
        memory_1.memoryStore.get.mockReturnValue([]);
        const buffer =
          yield dataExportService.exportUserDataAsBuffer("user-123");
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.length).toBeGreaterThan(0);
        const jsonString = buffer.toString("utf-8");
        expect(() => JSON.parse(jsonString)).not.toThrow();
      }));
  });
  describe("Data Integrity", () => {
    it("should preserve ISO date format in export", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const testDate = new Date("2024-01-15T10:30:00Z");
        const mockUser = {
          id: "user-123",
          name: "testuser",
          address: "GTEST123",
          tokenType: "XLM",
          role: "user",
          isDeployed: false,
          isFunded: false,
          isEmailVerified: false,
          createdAt: testDate,
          updatedAt: testDate,
        };
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue([]);
        mockRefreshTokenRepository.find.mockResolvedValue([]);
        memory_1.memoryStore.get.mockReturnValue([]);
        const result = yield dataExportService.exportUserData("user-123");
        expect(result.profile.createdAt).toBe(testDate.toISOString());
        expect(result.profile.updatedAt).toBe(testDate.toISOString());
      }));
    it("should handle large conversation history", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockUser = {
          id: "user-123",
          name: "testuser",
          address: "GTEST123",
          tokenType: "XLM",
          role: "user",
          isDeployed: false,
          isFunded: false,
          isEmailVerified: false,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        };
        const largeHistory = Array.from(
          { length: 1000 },
          (_, i) => `Entry ${i}`
        );
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockContactRepository.find.mockResolvedValue([]);
        mockRefreshTokenRepository.find.mockResolvedValue([]);
        memory_1.memoryStore.get.mockReturnValue(largeHistory);
        const result = yield dataExportService.exportUserData("user-123");
        expect(result.conversationHistory.totalEntries).toBe(1000);
        expect(result.conversationHistory.entries).toHaveLength(1000);
      }));
  });
});
