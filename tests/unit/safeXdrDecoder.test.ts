// tests/unit/safeXdrDecoder.test.ts

jest.unmock("@stellar/stellar-sdk");
jest.unmock("stellar-sdk");

const StellarSdk = jest.requireActual(
  "@stellar/stellar-sdk"
) as typeof import("@stellar/stellar-sdk");

import {
  SafeXdrDecoder,
  XdrPreValidator,
  safeScValToNative,
  DEFAULT_XDR_LIMITS,
  XdrByteLimitExceededError,
  XdrBase64LimitExceededError,
  XdrDepthLimitExceededError,
  XdrOperationLimitExceededError,
  XdrCollectionLimitExceededError,
  XdrComputationLimitExceededError,
  XdrMalformedError,
  sanitizeDiagnostic,
} from "../../src/utils/xdr";

describe("Backend SafeXdrDecoder Security & Resource Hardening (#663)", () => {
  const sourceKeypair = StellarSdk.Keypair.random();
  const destKeypair = StellarSdk.Keypair.random();

  describe("1. Pre-validation and Byte/Base64 Limits", () => {
    it("rejects null or undefined input with XdrMalformedError", () => {
      expect(() =>
        SafeXdrDecoder.decodeEnvelope(null as unknown as string)
      ).toThrow(XdrMalformedError);
      expect(() =>
        SafeXdrDecoder.decodeEnvelope(undefined as unknown as string)
      ).toThrow(XdrMalformedError);
    });

    it("rejects non-string non-buffer input types", () => {
      expect(() =>
        SafeXdrDecoder.decodeEnvelope(12345 as unknown as string)
      ).toThrow(XdrMalformedError);
      expect(() =>
        SafeXdrDecoder.decodeEnvelope({} as unknown as string)
      ).toThrow(XdrMalformedError);
    });

    it("rejects oversized base64 strings exceeding maxBase64Length", () => {
      const hugeBase64 = "AAAA".repeat(100_000); // 400KB > 350KB default limit
      expect(() =>
        SafeXdrDecoder.decodeEnvelope(hugeBase64, {
          limits: { maxBase64Length: 1000 },
        })
      ).toThrow(XdrBase64LimitExceededError);
    });

    it("rejects oversized raw buffers exceeding maxByteLength", () => {
      const hugeBuffer = Buffer.alloc(300 * 1024); // 300KB > 256KB default limit
      expect(() =>
        SafeXdrDecoder.decodeEnvelope(hugeBuffer, {
          limits: { maxByteLength: 256 * 1024 },
        })
      ).toThrow(XdrByteLimitExceededError);
    });

    it("rejects invalid non-base64 characters before buffer allocation", () => {
      const invalidBase64 = "!!@@##$$%%^^&&**(())==";
      expect(() => SafeXdrDecoder.decodeEnvelope(invalidBase64)).toThrow(
        XdrMalformedError
      );
    });

    it("rejects empty payload", () => {
      expect(() => SafeXdrDecoder.decodeEnvelope("")).toThrow(
        XdrMalformedError
      );
      expect(() => SafeXdrDecoder.decodeEnvelope(Buffer.alloc(0))).toThrow(
        XdrMalformedError
      );
    });
  });

  describe("2. Pathological Nesting Attacks (Stack Overflow Defense)", () => {
    it("successfully decodes shallowly nested ScVals within depth limit", () => {
      let currentVal = StellarSdk.xdr.ScVal.scvU32(42);
      for (let i = 0; i < 5; i++) {
        currentVal = StellarSdk.xdr.ScVal.scvVec([currentVal]);
      }
      const native = safeScValToNative(currentVal, {
        ...DEFAULT_XDR_LIMITS,
        maxDepth: 10,
      });
      expect(native).toEqual([[[[[42]]]]]);
    });

    it("rejects deeply nested ScVal vectors exceeding maxDepth", () => {
      let currentVal = StellarSdk.xdr.ScVal.scvU32(100);
      for (let i = 0; i < 40; i++) {
        currentVal = StellarSdk.xdr.ScVal.scvVec([currentVal]);
      }
      expect(() =>
        safeScValToNative(currentVal, { ...DEFAULT_XDR_LIMITS, maxDepth: 32 })
      ).toThrow(XdrDepthLimitExceededError);
    });

    it("rejects deeply nested ScVal maps exceeding maxDepth", () => {
      let currentVal = StellarSdk.xdr.ScVal.scvSymbol("inner");
      for (let i = 0; i < 35; i++) {
        const mapEntry = new StellarSdk.xdr.ScMapEntry({
          key: StellarSdk.xdr.ScVal.scvSymbol(`k${i}`),
          val: currentVal,
        });
        currentVal = StellarSdk.xdr.ScVal.scvMap([mapEntry]);
      }
      expect(() =>
        safeScValToNative(currentVal, { ...DEFAULT_XDR_LIMITS, maxDepth: 30 })
      ).toThrow(XdrDepthLimitExceededError);
    });
  });

  describe("3. Length-Field and Memory Allocation Bomb Attacks", () => {
    it("detects and rejects 4GB length header claim in tiny buffer", () => {
      const maliciousBuffer = Buffer.alloc(16);
      maliciousBuffer.writeUInt32BE(0xffffffff, 0); // Claims 4,294,967,295 elements
      expect(() =>
        XdrPreValidator.inspectLengthFields(maliciousBuffer, DEFAULT_XDR_LIMITS)
      ).toThrow(XdrMalformedError);
    });

    it("detects and rejects 2GB length header claim in tiny buffer", () => {
      const maliciousBuffer = Buffer.alloc(16);
      maliciousBuffer.writeUInt32BE(0x7fffffff, 0); // Claims 2,147,483,647 elements
      expect(() =>
        XdrPreValidator.inspectLengthFields(maliciousBuffer, DEFAULT_XDR_LIMITS)
      ).toThrow(XdrMalformedError);
    });
  });

  describe("4. Pathological Operation Count and Collection Bounds", () => {
    it("rejects ScVal vector with items exceeding maxCollectionEntries", () => {
      const items: StellarSdk.xdr.ScVal[] = [];
      for (let i = 0; i < 200; i++) {
        items.push(StellarSdk.xdr.ScVal.scvU32(i));
      }
      const vecVal = StellarSdk.xdr.ScVal.scvVec(items);
      expect(() =>
        safeScValToNative(vecVal, {
          ...DEFAULT_XDR_LIMITS,
          maxCollectionEntries: 100,
        })
      ).toThrow(XdrCollectionLimitExceededError);
    });

    it("enforces operation limits in transaction envelope decoding", () => {
      const account = new StellarSdk.Account(sourceKeypair.publicKey(), "1000");
      const builder = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      });

      for (let i = 0; i < 15; i++) {
        builder.addOperation(
          StellarSdk.Operation.payment({
            destination: destKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "1",
          })
        );
      }
      builder.setTimeout(300);
      const tx = builder.build();
      const envelopeXdr = tx.toXDR();

      expect(() =>
        SafeXdrDecoder.decodeEnvelope(envelopeXdr, {
          limits: { maxOperations: 10 },
        })
      ).toThrow(XdrOperationLimitExceededError);
    });
  });

  describe("5. Computation Step Budgeting", () => {
    it("throws XdrComputationLimitExceededError when total node visits exceed budget", () => {
      const items: StellarSdk.xdr.ScVal[] = [];
      for (let i = 0; i < 50; i++) {
        items.push(StellarSdk.xdr.ScVal.scvU32(i));
      }
      const vecVal = StellarSdk.xdr.ScVal.scvVec(items);
      expect(() =>
        safeScValToNative(vecVal, {
          ...DEFAULT_XDR_LIMITS,
          maxComputationSteps: 20,
        })
      ).toThrow(XdrComputationLimitExceededError);
    });
  });

  describe("6. Diagnostic Sanitization & Zero Payload Echoing", () => {
    it("never echoes secret or attacker payload in error diagnostic", () => {
      const secret = "SB6XQY7WNDD3LAKW7W6Z65LRO36C3G3Y4A65W445V7LMW7QWW2WWWWWW";
      const dirtyMsg = `Failed at payload AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA with key ${secret}`;
      const clean = sanitizeDiagnostic(dirtyMsg, 100);

      expect(clean).not.toContain(secret);
      expect(clean).toContain("<redacted_secret_key>");
      expect(clean).toContain("<redacted_payload>");
      expect(clean.length).toBeLessThanOrEqual(100);
    });
  });

  describe("7. Safe TryDecode Methods", () => {
    it("supports tryDecodeTransaction without throwing on malformed input", () => {
      const result = SafeXdrDecoder.tryDecodeTransaction(
        "malformed_xdr_payload"
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.transaction).toBeUndefined();
    });

    it("supports tryDecodeOperation without throwing on malformed input", () => {
      const result = SafeXdrDecoder.tryDecodeOperation("malformed_op_xdr");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.operation).toBeUndefined();
    });

    it("successfully decodes valid transaction", () => {
      const account = new StellarSdk.Account(sourceKeypair.publicKey(), "1000");
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "10",
          })
        )
        .setTimeout(300)
        .build();

      const result = SafeXdrDecoder.tryDecodeTransaction(tx.toXDR());
      expect(result.success).toBe(true);
      expect(result.operationCount).toBe(1);
      expect(result.transaction).toBeDefined();
    });
  });
});
