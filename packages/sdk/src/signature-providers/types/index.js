"use strict";
/**
 * @fileoverview Comprehensive TypeScript type definitions for SignatureProvider system
 * @module SignatureProviders/Types
 */
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __exportStar =
  (this && this.__exportStar) ||
  function (m, exports) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p))
        __createBinding(exports, m, p);
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROVIDER_FEATURES =
  exports.DEFAULT_PROVIDER_COMPATIBILITY =
  exports.BrandedTypes =
  exports.TypeGuards =
    void 0;
// Re-export all core types for easy access
__exportStar(require("../types"), exports);
__exportStar(require("../interfaces"), exports);
__exportStar(require("../errors"), exports);
__exportStar(require("../error-recovery"), exports);
__exportStar(require("../registry"), exports);
__exportStar(require("../utils"), exports);
__exportStar(require("../mock-provider"), exports);
__exportStar(require("../ledger-provider"), exports);
__exportStar(require("../albedo-provider"), exports);
__exportStar(require("../multi-signature-coordinator"), exports);
__exportStar(require("../signature-verification"), exports);
__exportStar(require("../provider-factory"), exports);
// Additional type utilities and helpers
const types_1 = require("../../types");
const provider_factory_1 = require("../provider-factory");
/**
 * Type guards for runtime type checking
 */
var TypeGuards;
(function (TypeGuards) {
  function isSignatureProvider(obj) {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "providerId" in obj &&
      "connect" in obj &&
      "disconnect" in obj &&
      "signTransaction" in obj &&
      "getCapabilities" in obj
    );
  }
  TypeGuards.isSignatureProvider = isSignatureProvider;
  function isSignatureResult(obj) {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "signature" in obj &&
      "publicKey" in obj &&
      typeof obj.signature === "string" &&
      typeof obj.publicKey === "string"
    );
  }
  TypeGuards.isSignatureResult = isSignatureResult;
  function isChainTransaction(obj) {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "chainId" in obj &&
      "transaction" in obj &&
      Object.values(types_1.ChainId).includes(obj.chainId)
    );
  }
  TypeGuards.isChainTransaction = isChainTransaction;
  function isProviderCapabilities(obj) {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "supportedChains" in obj &&
      "supportsMultipleAccounts" in obj &&
      "requiresUserInteraction" in obj &&
      "supportsMessageSigning" in obj &&
      "maxConcurrentSignatures" in obj &&
      Array.isArray(obj.supportedChains)
    );
  }
  TypeGuards.isProviderCapabilities = isProviderCapabilities;
})(TypeGuards || (exports.TypeGuards = TypeGuards = {}));
/**
 * Helper functions for creating branded types
 */
var BrandedTypes;
(function (BrandedTypes) {
  function createProviderId(id) {
    return id;
  }
  BrandedTypes.createProviderId = createProviderId;
  function createTransactionId(id) {
    return id;
  }
  BrandedTypes.createTransactionId = createTransactionId;
  function createSignatureHash(hash) {
    return hash;
  }
  BrandedTypes.createSignatureHash = createSignatureHash;
  function createPublicKeyHash(hash) {
    return hash;
  }
  BrandedTypes.createPublicKeyHash = createPublicKeyHash;
})(BrandedTypes || (exports.BrandedTypes = BrandedTypes = {}));
/**
 * Default provider compatibility
 */
exports.DEFAULT_PROVIDER_COMPATIBILITY = {
  [provider_factory_1.ProviderType.MOCK]: {
    [types_1.ChainId.BITCOIN]: true,
    [types_1.ChainId.STELLAR]: true,
    [types_1.ChainId.STARKNET]: true,
  },
  [provider_factory_1.ProviderType.LEDGER]: {
    [types_1.ChainId.BITCOIN]: true,
    [types_1.ChainId.STELLAR]: true,
    [types_1.ChainId.STARKNET]: true,
  },
  [provider_factory_1.ProviderType.ALBEDO]: {
    [types_1.ChainId.BITCOIN]: false,
    [types_1.ChainId.STELLAR]: true,
    [types_1.ChainId.STARKNET]: false,
  },
};
/**
 * Default provider features
 */
exports.DEFAULT_PROVIDER_FEATURES = {
  [provider_factory_1.ProviderType.MOCK]: {
    messageSignature: true,
    multipleAccounts: true,
    hardwareWallet: false,
    browserExtension: false,
    userInteractionRequired: false,
    concurrentSignatures: 10,
  },
  [provider_factory_1.ProviderType.LEDGER]: {
    messageSignature: false,
    multipleAccounts: true,
    hardwareWallet: true,
    browserExtension: false,
    userInteractionRequired: true,
    concurrentSignatures: 1,
  },
  [provider_factory_1.ProviderType.ALBEDO]: {
    messageSignature: true,
    multipleAccounts: false,
    hardwareWallet: false,
    browserExtension: true,
    userInteractionRequired: true,
    concurrentSignatures: 1,
  },
};
