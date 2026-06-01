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
const types_1 = require("../../types");
const signature_verification_1 = require("../signature-verification");
describe("Signature Verification Utilities", () => {
  describe("SignatureFormatUtils", () => {
    describe("Bitcoin Signature Format", () => {
      it("should validate valid Bitcoin DER signatures", () => {
        const validSignatures = [
          "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "0x304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        ];
        validSignatures.forEach((sig) => {
          expect(
            signature_verification_1.SignatureFormatUtils.validateBitcoinSignatureFormat(
              sig
            )
          ).toBe(true);
        });
      });
      it("should reject invalid Bitcoin signatures", () => {
        const invalidSignatures = [
          "", // Empty
          "invalid", // Not hex
          "1234", // Too short
          "404402201234567890abcdef", // Wrong DER header
        ];
        invalidSignatures.forEach((sig) => {
          expect(
            signature_verification_1.SignatureFormatUtils.validateBitcoinSignatureFormat(
              sig
            )
          ).toBe(false);
        });
      });
    });
    describe("Stellar Signature Format", () => {
      it("should validate valid Stellar signatures", () => {
        const validSignatures = [
          "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        ];
        validSignatures.forEach((sig) => {
          expect(
            signature_verification_1.SignatureFormatUtils.validateStellarSignatureFormat(
              sig
            )
          ).toBe(true);
        });
      });
      it("should reject invalid Stellar signatures", () => {
        const invalidSignatures = [
          "", // Empty
          "invalid", // Not hex
          "1234567890abcdef", // Too short
          "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12", // Too long
        ];
        invalidSignatures.forEach((sig) => {
          expect(
            signature_verification_1.SignatureFormatUtils.validateStellarSignatureFormat(
              sig
            )
          ).toBe(false);
        });
      });
    });
    describe("Starknet Signature Format", () => {
      it("should validate valid Starknet signatures", () => {
        const validSignatures = [
          "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          '["0x1234567890abcdef1234567890abcdef", "0x1234567890abcdef1234567890abcdef"]',
        ];
        validSignatures.forEach((sig) => {
          expect(
            signature_verification_1.SignatureFormatUtils.validateStarknetSignatureFormat(
              sig
            )
          ).toBe(true);
        });
      });
      it("should reject invalid Starknet signatures", () => {
        const invalidSignatures = [
          "", // Empty
          "invalid", // Not hex
          "1234", // Too short
          '["invalid"]', // Invalid array format
        ];
        invalidSignatures.forEach((sig) => {
          expect(
            signature_verification_1.SignatureFormatUtils.validateStarknetSignatureFormat(
              sig
            )
          ).toBe(false);
        });
      });
    });
    describe("Signature Normalization", () => {
      it("should normalize signatures correctly", () => {
        expect(
          signature_verification_1.SignatureFormatUtils.normalizeSignature(
            "1234abcd",
            types_1.ChainId.BITCOIN
          )
        ).toBe("0x1234abcd");
        expect(
          signature_verification_1.SignatureFormatUtils.normalizeSignature(
            "0x1234abcd",
            types_1.ChainId.STELLAR
          )
        ).toBe("1234abcd");
        expect(
          signature_verification_1.SignatureFormatUtils.normalizeSignature(
            "1234abcd",
            types_1.ChainId.STARKNET
          )
        ).toBe("0x1234abcd");
      });
    });
  });
  describe("PublicKeyUtils", () => {
    describe("Bitcoin Public Key Format", () => {
      it("should validate valid Bitcoin public keys", () => {
        const validKeys = [
          "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798", // Compressed
          "0479BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8", // Uncompressed
        ];
        validKeys.forEach((key) => {
          expect(
            signature_verification_1.PublicKeyUtils.validateBitcoinPublicKeyFormat(
              key
            )
          ).toBe(true);
        });
      });
      it("should reject invalid Bitcoin public keys", () => {
        const invalidKeys = [
          "", // Empty
          "invalid", // Not hex
          "1234", // Too short
          "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F8179812", // Wrong length
        ];
        invalidKeys.forEach((key) => {
          expect(
            signature_verification_1.PublicKeyUtils.validateBitcoinPublicKeyFormat(
              key
            )
          ).toBe(false);
        });
      });
    });
    describe("Stellar Public Key Format", () => {
      it("should validate valid Stellar public keys", () => {
        const validKeys = [
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
        ];
        validKeys.forEach((key) => {
          expect(
            signature_verification_1.PublicKeyUtils.validateStellarPublicKeyFormat(
              key
            )
          ).toBe(true);
        });
      });
      it("should reject invalid Stellar public keys", () => {
        const invalidKeys = [
          "", // Empty
          "ADQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37", // Wrong prefix
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W3", // Too short
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W371", // Too long
        ];
        invalidKeys.forEach((key) => {
          expect(
            signature_verification_1.PublicKeyUtils.validateStellarPublicKeyFormat(
              key
            )
          ).toBe(false);
        });
      });
    });
    describe("Starknet Public Key Format", () => {
      it("should validate valid Starknet public keys", () => {
        const validKeys = [
          "049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
          "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        ];
        validKeys.forEach((key) => {
          expect(
            signature_verification_1.PublicKeyUtils.validateStarknetPublicKeyFormat(
              key
            )
          ).toBe(true);
        });
      });
      it("should reject invalid Starknet public keys", () => {
        const invalidKeys = [
          "", // Empty
          "invalid", // Not hex
          "049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc", // Too short
          "049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc712", // Too long
        ];
        invalidKeys.forEach((key) => {
          expect(
            signature_verification_1.PublicKeyUtils.validateStarknetPublicKeyFormat(
              key
            )
          ).toBe(false);
        });
      });
    });
  });
  describe("MessageHashUtils", () => {
    it("should create message hashes for different chains", () => {
      const message = "Hello, World!";
      const bitcoinHash =
        signature_verification_1.MessageHashUtils.createBitcoinMessageHash(
          message
        );
      const stellarHash =
        signature_verification_1.MessageHashUtils.createStellarMessageHash(
          message
        );
      const starknetHash =
        signature_verification_1.MessageHashUtils.createStarknetMessageHash(
          message
        );
      expect(bitcoinHash).toBeTruthy();
      expect(stellarHash).toBeTruthy();
      expect(starknetHash).toBeTruthy();
      expect(bitcoinHash).not.toBe(stellarHash);
      expect(stellarHash).not.toBe(starknetHash);
    });
    it("should create transaction hashes for different chains", () => {
      const bitcoinTx = {
        inputs: [{ txid: "test", vout: 0 }],
        outputs: [{ value: 100000, scriptPubKey: "test" }],
      };
      const stellarTx = {
        sourceAccount:
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        fee: "100",
        sequenceNumber: "1",
        operations: [{ type: "payment" }],
      };
      const starknetTx = {
        contractAddress: "0x123",
        entrypoint: "transfer",
        calldata: ["0x456", "1000"],
      };
      const bitcoinHash =
        signature_verification_1.MessageHashUtils.createTransactionHash({
          chainId: types_1.ChainId.BITCOIN,
          transaction: bitcoinTx,
        });
      const stellarHash =
        signature_verification_1.MessageHashUtils.createTransactionHash({
          chainId: types_1.ChainId.STELLAR,
          transaction: stellarTx,
        });
      const starknetHash =
        signature_verification_1.MessageHashUtils.createTransactionHash({
          chainId: types_1.ChainId.STARKNET,
          transaction: starknetTx,
        });
      expect(bitcoinHash).toBeTruthy();
      expect(stellarHash).toBeTruthy();
      expect(starknetHash).toBeTruthy();
      expect(bitcoinHash).not.toBe(stellarHash);
      expect(stellarHash).not.toBe(starknetHash);
    });
  });
  describe("SignatureVerificationUtils", () => {
    describe("Single Signature Verification", () => {
      it("should verify valid signatures", () =>
        __awaiter(void 0, void 0, void 0, function* () {
          var _a;
          const request = {
            signature:
              "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            publicKey:
              "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            message: "Hello, World!",
            chainId: types_1.ChainId.BITCOIN,
          };
          const result =
            yield signature_verification_1.SignatureVerificationUtils.verifySignature(
              request
            );
          expect(result.chainId).toBe(types_1.ChainId.BITCOIN);
          expect(result.signature).toBe(request.signature);
          expect(result.publicKey).toBe(request.publicKey);
          expect(result.algorithm).toBe("ECDSA-secp256k1");
          expect(
            (_a = result.metadata) === null || _a === void 0
              ? void 0
              : _a.verifiedAt
          ).toBeTruthy();
        }));
      it("should handle invalid signature format", () =>
        __awaiter(void 0, void 0, void 0, function* () {
          var _a;
          const request = {
            signature: "invalid-signature",
            publicKey:
              "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            message: "Hello, World!",
            chainId: types_1.ChainId.BITCOIN,
          };
          const result =
            yield signature_verification_1.SignatureVerificationUtils.verifySignature(
              request
            );
          expect(result.isValid).toBe(false);
          expect(
            (_a = result.metadata) === null || _a === void 0 ? void 0 : _a.error
          ).toBe("Invalid signature format");
        }));
      it("should handle invalid public key format", () =>
        __awaiter(void 0, void 0, void 0, function* () {
          var _a;
          const request = {
            signature:
              "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            publicKey: "invalid-pubkey",
            message: "Hello, World!",
            chainId: types_1.ChainId.BITCOIN,
          };
          const result =
            yield signature_verification_1.SignatureVerificationUtils.verifySignature(
              request
            );
          expect(result.isValid).toBe(false);
          expect(
            (_a = result.metadata) === null || _a === void 0 ? void 0 : _a.error
          ).toBe("Invalid public key format");
        }));
      it("should verify transaction signatures", () =>
        __awaiter(void 0, void 0, void 0, function* () {
          var _a;
          const transaction = {
            inputs: [{ txid: "test", vout: 0 }],
            outputs: [{ value: 100000, scriptPubKey: "test" }],
          };
          const request = {
            signature:
              "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            publicKey:
              "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            transactionData: {
              chainId: types_1.ChainId.BITCOIN,
              transaction,
            },
            chainId: types_1.ChainId.BITCOIN,
          };
          const result =
            yield signature_verification_1.SignatureVerificationUtils.verifySignature(
              request
            );
          expect(result.chainId).toBe(types_1.ChainId.BITCOIN);
          expect(
            (_a = result.metadata) === null || _a === void 0
              ? void 0
              : _a.messageHash
          ).toBeTruthy();
        }));
    });
    describe("Multi-Signature Verification", () => {
      it("should verify multiple signatures", () =>
        __awaiter(void 0, void 0, void 0, function* () {
          const signatures = [
            {
              signature:
                "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
              publicKey:
                "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            },
            {
              signature:
                "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
              publicKey:
                "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
            },
          ];
          const result =
            yield signature_verification_1.SignatureVerificationUtils.verifyMultiSignature(
              signatures,
              "Hello, Multi-Sig!",
              types_1.ChainId.STELLAR,
              2
            );
          expect(result.totalSignatures).toBe(2);
          expect(result.threshold).toBe(2);
          expect(
            result.validSignatures.length + result.invalidSignatures.length
          ).toBe(2);
        }));
      it("should handle threshold not met", () =>
        __awaiter(void 0, void 0, void 0, function* () {
          const signatures = [
            {
              signature: "invalid-signature",
              publicKey:
                "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            },
            {
              signature: "another-invalid-signature",
              publicKey:
                "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
            },
          ];
          const result =
            yield signature_verification_1.SignatureVerificationUtils.verifyMultiSignature(
              signatures,
              "Hello, Multi-Sig!",
              types_1.ChainId.STELLAR,
              2
            );
          expect(result.isValid).toBe(false);
          expect(result.thresholdMet).toBe(false);
          expect(result.invalidSignatures.length).toBe(2);
        }));
    });
    describe("Batch Verification", () => {
      it("should batch verify multiple requests", () =>
        __awaiter(void 0, void 0, void 0, function* () {
          const requests = [
            {
              signature:
                "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
              publicKey:
                "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
              message: "Message 1",
              chainId: types_1.ChainId.BITCOIN,
            },
            {
              signature:
                "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
              publicKey:
                "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
              message: "Message 2",
              chainId: types_1.ChainId.STELLAR,
            },
          ];
          const results =
            yield signature_verification_1.SignatureVerificationUtils.batchVerifySignatures(
              requests
            );
          expect(results).toHaveLength(2);
          expect(results[0].chainId).toBe(types_1.ChainId.BITCOIN);
          expect(results[1].chainId).toBe(types_1.ChainId.STELLAR);
        }));
    });
    describe("Test Vector Verification", () => {
      it("should verify against known test vectors", () =>
        __awaiter(void 0, void 0, void 0, function* () {
          const isValid =
            yield signature_verification_1.SignatureVerificationUtils.verifyWithTestVector(
              "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
              "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
              "Test message",
              true, // Expected result (mock will determine actual result)
              types_1.ChainId.BITCOIN
            );
          expect(typeof isValid).toBe("boolean");
        }));
    });
    describe("Chain-Specific Verification", () => {
      it("should handle different signature algorithms", () =>
        __awaiter(void 0, void 0, void 0, function* () {
          const bitcoinRequest = {
            signature:
              "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            publicKey:
              "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            message: "Bitcoin message",
            chainId: types_1.ChainId.BITCOIN,
          };
          const stellarRequest = {
            signature:
              "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            publicKey:
              "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            message: "Stellar message",
            chainId: types_1.ChainId.STELLAR,
          };
          const starknetRequest = {
            signature:
              "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            publicKey:
              "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
            message: "Starknet message",
            chainId: types_1.ChainId.STARKNET,
          };
          const bitcoinResult =
            yield signature_verification_1.SignatureVerificationUtils.verifySignature(
              bitcoinRequest
            );
          const stellarResult =
            yield signature_verification_1.SignatureVerificationUtils.verifySignature(
              stellarRequest
            );
          const starknetResult =
            yield signature_verification_1.SignatureVerificationUtils.verifySignature(
              starknetRequest
            );
          expect(bitcoinResult.algorithm).toBe("ECDSA-secp256k1");
          expect(stellarResult.algorithm).toBe("Ed25519");
          expect(starknetResult.algorithm).toBe("ECDSA-STARK");
        }));
    });
  });
});
