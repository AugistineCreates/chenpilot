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
exports.SignatureVerificationUtils =
  exports.MessageHashUtils =
  exports.PublicKeyUtils =
  exports.SignatureFormatUtils =
    void 0;
const types_1 = require("../types");
const errors_1 = require("./errors");
/**
 * Signature format utilities for different chains
 */
class SignatureFormatUtils {
  /**
   * Validate signature format for specific chain
   */
  static validateSignatureFormat(signature, chainId) {
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return this.validateBitcoinSignatureFormat(signature);
      case types_1.ChainId.STELLAR:
        return this.validateStellarSignatureFormat(signature);
      case types_1.ChainId.STARKNET:
        return this.validateStarknetSignatureFormat(signature);
      default:
        throw new errors_1.UnsupportedChainError(chainId);
    }
  }
  /**
   * Validate Bitcoin signature format (DER encoding)
   */
  static validateBitcoinSignatureFormat(signature) {
    // Bitcoin signatures are typically DER-encoded
    // Format: 0x30 [total-length] 0x02 [R-length] [R] 0x02 [S-length] [S] [sighash-type]
    if (!signature || signature.length < 8) {
      return false;
    }
    // Remove 0x prefix if present
    const sig = signature.startsWith("0x") ? signature.slice(2) : signature;
    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(sig)) {
      return false;
    }
    // Basic DER format validation
    if (sig.length < 8 || sig.length > 144) {
      // Max DER signature length
      return false;
    }
    // Should start with 0x30 (DER sequence)
    return sig.startsWith("30");
  }
  /**
   * Validate Stellar signature format (64 bytes)
   */
  static validateStellarSignatureFormat(signature) {
    if (!signature) {
      return false;
    }
    // Remove 0x prefix if present
    const sig = signature.startsWith("0x") ? signature.slice(2) : signature;
    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(sig)) {
      return false;
    }
    // Stellar signatures are 64 bytes (128 hex characters)
    return sig.length === 128;
  }
  /**
   * Validate Starknet signature format
   */
  static validateStarknetSignatureFormat(signature) {
    if (!signature) {
      return false;
    }
    // Starknet signatures can be arrays or single values
    if (signature.startsWith("[") && signature.endsWith("]")) {
      try {
        const sigArray = JSON.parse(signature);
        return Array.isArray(sigArray) && sigArray.length >= 2;
      } catch (_a) {
        return false;
      }
    }
    // Single signature format
    const sig = signature.startsWith("0x") ? signature.slice(2) : signature;
    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(sig)) {
      return false;
    }
    // Starknet signatures are typically 64 bytes (128 hex characters)
    return sig.length === 128;
  }
  /**
   * Normalize signature format for verification
   */
  static normalizeSignature(signature, chainId) {
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return signature.startsWith("0x") ? signature : `0x${signature}`;
      case types_1.ChainId.STELLAR:
        return signature.startsWith("0x") ? signature.slice(2) : signature;
      case types_1.ChainId.STARKNET:
        return signature.startsWith("0x") ? signature : `0x${signature}`;
      default:
        return signature;
    }
  }
}
exports.SignatureFormatUtils = SignatureFormatUtils;
/**
 * Public key utilities for different chains
 */
class PublicKeyUtils {
  /**
   * Validate public key format for specific chain
   */
  static validatePublicKeyFormat(publicKey, chainId) {
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return this.validateBitcoinPublicKeyFormat(publicKey);
      case types_1.ChainId.STELLAR:
        return this.validateStellarPublicKeyFormat(publicKey);
      case types_1.ChainId.STARKNET:
        return this.validateStarknetPublicKeyFormat(publicKey);
      default:
        throw new errors_1.UnsupportedChainError(chainId);
    }
  }
  /**
   * Validate Bitcoin public key format
   */
  static validateBitcoinPublicKeyFormat(publicKey) {
    if (!publicKey) {
      return false;
    }
    const key = publicKey.startsWith("0x") ? publicKey.slice(2) : publicKey;
    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(key)) {
      return false;
    }
    // Compressed public key (33 bytes) or uncompressed (65 bytes)
    return key.length === 66 || key.length === 130;
  }
  /**
   * Validate Stellar public key format (Ed25519)
   */
  static validateStellarPublicKeyFormat(publicKey) {
    if (!publicKey) {
      return false;
    }
    // Stellar public keys start with 'G' and are 56 characters long
    return /^G[A-Z2-7]{55}$/.test(publicKey);
  }
  /**
   * Validate Starknet public key format
   */
  static validateStarknetPublicKeyFormat(publicKey) {
    if (!publicKey) {
      return false;
    }
    const key = publicKey.startsWith("0x") ? publicKey.slice(2) : publicKey;
    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(key)) {
      return false;
    }
    // Starknet public keys are 32 bytes (64 hex characters)
    return key.length === 64;
  }
  /**
   * Normalize public key format
   */
  static normalizePublicKey(publicKey, chainId) {
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return publicKey.startsWith("0x") ? publicKey : `0x${publicKey}`;
      case types_1.ChainId.STELLAR:
        return publicKey; // Stellar keys are already in correct format
      case types_1.ChainId.STARKNET:
        return publicKey.startsWith("0x") ? publicKey : `0x${publicKey}`;
      default:
        return publicKey;
    }
  }
}
exports.PublicKeyUtils = PublicKeyUtils;
/**
 * Message hashing utilities for signature verification
 */
class MessageHashUtils {
  /**
   * Create message hash for signature verification
   */
  static createMessageHash(message, chainId) {
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return this.createBitcoinMessageHash(message);
      case types_1.ChainId.STELLAR:
        return this.createStellarMessageHash(message);
      case types_1.ChainId.STARKNET:
        return this.createStarknetMessageHash(message);
      default:
        throw new errors_1.UnsupportedChainError(chainId);
    }
  }
  /**
   * Create Bitcoin message hash (double SHA256)
   */
  static createBitcoinMessageHash(message) {
    // Mock implementation - in real implementation would use crypto libraries
    return this.mockHash(`bitcoin:${message}`);
  }
  /**
   * Create Stellar message hash (SHA256)
   */
  static createStellarMessageHash(message) {
    // Mock implementation - in real implementation would use crypto libraries
    return this.mockHash(`stellar:${message}`);
  }
  /**
   * Create Starknet message hash (Pedersen hash)
   */
  static createStarknetMessageHash(message) {
    // Mock implementation - in real implementation would use Starknet crypto
    return this.mockHash(`starknet:${message}`);
  }
  /**
   * Create transaction hash for verification
   */
  static createTransactionHash(transactionData) {
    const { chainId, transaction } = transactionData;
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return this.createBitcoinTransactionHash(transaction);
      case types_1.ChainId.STELLAR:
        return this.createStellarTransactionHash(transaction);
      case types_1.ChainId.STARKNET:
        return this.createStarknetTransactionHash(transaction);
      default:
        throw new errors_1.UnsupportedChainError(chainId);
    }
  }
  static createBitcoinTransactionHash(tx) {
    // Mock implementation - would serialize and hash transaction
    return this.mockHash(`btc_tx:${JSON.stringify(tx)}`);
  }
  static createStellarTransactionHash(tx) {
    // Mock implementation - would use Stellar SDK to create transaction hash
    return this.mockHash(`stellar_tx:${JSON.stringify(tx)}`);
  }
  static createStarknetTransactionHash(tx) {
    // Mock implementation - would use Starknet libraries
    return this.mockHash(`starknet_tx:${JSON.stringify(tx)}`);
  }
  static mockHash(input) {
    // Simple mock hash function for development
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(64, "0");
  }
}
exports.MessageHashUtils = MessageHashUtils;
/**
 * Main signature verification utility class
 */
class SignatureVerificationUtils {
  /**
   * Verify a single signature
   */
  static verifySignature(request) {
    return __awaiter(this, void 0, void 0, function* () {
      const { signature, publicKey, message, transactionData, chainId } =
        request;
      // Validate inputs
      if (!SignatureFormatUtils.validateSignatureFormat(signature, chainId)) {
        return {
          isValid: false,
          publicKey,
          signature,
          chainId,
          metadata: { error: "Invalid signature format" },
        };
      }
      if (!PublicKeyUtils.validatePublicKeyFormat(publicKey, chainId)) {
        return {
          isValid: false,
          publicKey,
          signature,
          chainId,
          metadata: { error: "Invalid public key format" },
        };
      }
      try {
        // Determine what to verify
        let messageToVerify;
        if (message) {
          messageToVerify = MessageHashUtils.createMessageHash(
            message,
            chainId
          );
        } else if (transactionData) {
          messageToVerify =
            MessageHashUtils.createTransactionHash(transactionData);
        } else {
          throw new errors_1.InvalidTransactionError(
            "Either message or transactionData must be provided"
          );
        }
        // Perform chain-specific verification
        const isValid = yield this.performChainSpecificVerification(
          signature,
          publicKey,
          messageToVerify,
          chainId
        );
        return {
          isValid,
          publicKey,
          signature,
          message: messageToVerify,
          chainId,
          algorithm: this.getSignatureAlgorithm(chainId),
          metadata: {
            verifiedAt: new Date().toISOString(),
            messageHash: messageToVerify,
          },
        };
      } catch (error) {
        return {
          isValid: false,
          publicKey,
          signature,
          chainId,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    });
  }
  /**
   * Verify multiple signatures (multi-signature verification)
   */
  static verifyMultiSignature(signatures_1, message_1, chainId_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function* (signatures, message, chainId, threshold = signatures.length) {
        const verificationPromises = signatures.map(
          ({ signature, publicKey }) => {
            const request = Object.assign(
              { signature, publicKey, chainId },
              typeof message === "string"
                ? { message }
                : { transactionData: message }
            );
            return this.verifySignature(request);
          }
        );
        const results = yield Promise.all(verificationPromises);
        const validSignatures = results.filter((r) => r.isValid);
        const invalidSignatures = results.filter((r) => !r.isValid);
        const thresholdMet = validSignatures.length >= threshold;
        return {
          isValid: thresholdMet,
          validSignatures,
          invalidSignatures,
          threshold,
          thresholdMet,
          totalSignatures: signatures.length,
          metadata: {
            verifiedAt: new Date().toISOString(),
            validCount: validSignatures.length,
            invalidCount: invalidSignatures.length,
          },
        };
      }
    );
  }
  /**
   * Verify signature against known test vectors
   */
  static verifyWithTestVector(
    signature,
    publicKey,
    message,
    expectedResult,
    chainId
  ) {
    return __awaiter(this, void 0, void 0, function* () {
      const result = yield this.verifySignature({
        signature,
        publicKey,
        message,
        chainId,
      });
      return result.isValid === expectedResult;
    });
  }
  /**
   * Batch verify multiple signatures efficiently
   */
  static batchVerifySignatures(requests) {
    return __awaiter(this, void 0, void 0, function* () {
      // Group by chain for potential optimization
      const requestsByChain = new Map();
      for (const request of requests) {
        if (!requestsByChain.has(request.chainId)) {
          requestsByChain.set(request.chainId, []);
        }
        requestsByChain.get(request.chainId).push(request);
      }
      // Verify all requests (could be optimized per chain)
      const allPromises = requests.map((request) =>
        this.verifySignature(request)
      );
      return Promise.all(allPromises);
    });
  }
  static performChainSpecificVerification(
    signature,
    publicKey,
    messageHash,
    chainId
  ) {
    return __awaiter(this, void 0, void 0, function* () {
      // Normalize inputs
      const normalizedSignature = SignatureFormatUtils.normalizeSignature(
        signature,
        chainId
      );
      const normalizedPublicKey = PublicKeyUtils.normalizePublicKey(
        publicKey,
        chainId
      );
      switch (chainId) {
        case types_1.ChainId.BITCOIN:
          return this.verifyBitcoinSignature(
            normalizedSignature,
            normalizedPublicKey,
            messageHash
          );
        case types_1.ChainId.STELLAR:
          return this.verifyStellarSignature(
            normalizedSignature,
            normalizedPublicKey,
            messageHash
          );
        case types_1.ChainId.STARKNET:
          return this.verifyStarknetSignature(
            normalizedSignature,
            normalizedPublicKey,
            messageHash
          );
        default:
          throw new errors_1.UnsupportedChainError(chainId);
      }
    });
  }
  static verifyBitcoinSignature(signature, publicKey, messageHash) {
    return __awaiter(this, void 0, void 0, function* () {
      // Mock Bitcoin signature verification
      // In real implementation, would use secp256k1 library
      return this.mockVerification(
        signature,
        publicKey,
        messageHash,
        "bitcoin"
      );
    });
  }
  static verifyStellarSignature(signature, publicKey, messageHash) {
    return __awaiter(this, void 0, void 0, function* () {
      // Mock Stellar signature verification
      // In real implementation, would use Ed25519 verification
      return this.mockVerification(
        signature,
        publicKey,
        messageHash,
        "stellar"
      );
    });
  }
  static verifyStarknetSignature(signature, publicKey, messageHash) {
    return __awaiter(this, void 0, void 0, function* () {
      // Mock Starknet signature verification
      // In real implementation, would use Starknet crypto libraries
      return this.mockVerification(
        signature,
        publicKey,
        messageHash,
        "starknet"
      );
    });
  }
  static mockVerification(signature, publicKey, messageHash, chain) {
    // Simple mock verification for development
    // In real implementation, this would perform actual cryptographic verification
    const combined = `${signature}:${publicKey}:${messageHash}:${chain}`;
    const hash = this.simpleHash(combined);
    // Mock: signature is "valid" if hash is even
    return hash % 2 === 0;
  }
  static simpleHash(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
  static getSignatureAlgorithm(chainId) {
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return "ECDSA-secp256k1";
      case types_1.ChainId.STELLAR:
        return "Ed25519";
      case types_1.ChainId.STARKNET:
        return "ECDSA-STARK";
      default:
        return "Unknown";
    }
  }
}
exports.SignatureVerificationUtils = SignatureVerificationUtils;
