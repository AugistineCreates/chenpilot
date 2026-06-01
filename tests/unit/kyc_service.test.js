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
const KycProviderFactory_1 = require("../../src/services/kyc/KycProviderFactory");
const KycService_1 = require("../../src/services/kyc/KycService");
const mockKycProvider_1 = require("../../src/services/kyc/providers/mockKycProvider");
describe("KycProviderFactory", () => {
  it("returns default provider when no provider name is specified", () => {
    const factory = new KycProviderFactory_1.KycProviderFactory("mock");
    const provider = new mockKycProvider_1.MockKycProvider();
    factory.register(provider);
    expect(factory.getProvider()).toBe(provider);
  });
  it("throws when provider is not registered", () => {
    const factory = new KycProviderFactory_1.KycProviderFactory("unknown");
    expect(() => factory.getProvider()).toThrow(
      "KYC provider 'unknown' is not registered"
    );
  });
  it("can switch default provider", () => {
    const factory = new KycProviderFactory_1.KycProviderFactory("mock");
    const mock = new mockKycProvider_1.MockKycProvider();
    const stub = {
      name: "stub",
      createVerification: jest.fn(),
      getVerificationStatus: jest.fn(),
      healthCheck: jest.fn(),
    };
    factory.register(mock);
    factory.register(stub);
    factory.setDefaultProvider("stub");
    expect(factory.getProvider()).toBe(stub);
    expect(factory.getRegisteredProviders().sort()).toEqual(["mock", "stub"]);
  });
});
describe("KycService", () => {
  const baseRequest = {
    person: {
      userId: "user-123",
      fullName: "Jane Doe",
      email: "jane@example.com",
      countryCode: "US",
    },
    documents: [
      {
        type: "passport",
        documentId: "passport-1",
      },
    ],
    metadata: {
      flow: "onboarding",
    },
  };
  it("submits verification through selected provider", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const factory = new KycProviderFactory_1.KycProviderFactory("mock");
      factory.register(new mockKycProvider_1.MockKycProvider());
      const service = new KycService_1.KycService(factory);
      const result = yield service.submitVerification(baseRequest);
      expect(result.provider).toBe("mock");
      expect(result.providerReferenceId).toContain("kyc_user-123_");
      expect(result.status).toBe("pending");
    }));
  it("retrieves verification status by provider reference id", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const factory = new KycProviderFactory_1.KycProviderFactory("mock");
      factory.register(new mockKycProvider_1.MockKycProvider());
      const service = new KycService_1.KycService(factory);
      const created = yield service.submitVerification(baseRequest);
      const status = yield service.getVerificationStatus(
        created.providerReferenceId
      );
      expect(status).not.toBeNull();
      expect(
        status === null || status === void 0
          ? void 0
          : status.providerReferenceId
      ).toBe(created.providerReferenceId);
      expect(
        status === null || status === void 0 ? void 0 : status.status
      ).toBe("pending");
    }));
  it("supports provider-driven rejection outcomes", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const factory = new KycProviderFactory_1.KycProviderFactory("mock");
      factory.register(new mockKycProvider_1.MockKycProvider());
      const service = new KycService_1.KycService(factory);
      const rejectedRequest = Object.assign(Object.assign({}, baseRequest), {
        person: Object.assign(Object.assign({}, baseRequest.person), {
          fullName: "Reject Candidate",
        }),
      });
      const result = yield service.submitVerification(rejectedRequest);
      expect(result.status).toBe("rejected");
      expect(result.reason).toContain("Mock provider");
    }));
  it("delegates health checks to provider", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const healthyProvider = {
        name: "healthy",
        createVerification: jest.fn().mockResolvedValue({
          provider: "healthy",
          providerReferenceId: "ref-1",
          status: "approved",
        }),
        getVerificationStatus: jest.fn().mockResolvedValue(null),
        healthCheck: jest.fn().mockResolvedValue(true),
      };
      const factory = new KycProviderFactory_1.KycProviderFactory("healthy");
      factory.register(healthyProvider);
      const service = new KycService_1.KycService(factory);
      const result = yield service.healthCheck();
      expect(result).toBe(true);
      expect(healthyProvider.healthCheck).toHaveBeenCalledTimes(1);
    }));
});
