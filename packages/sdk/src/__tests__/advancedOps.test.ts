/**
 * Tests for the unified advanced operations package — Issue #572
 */

import {
  AdvancedOperationComposer,
  AdvancedOperationFamily,
  AdvancedOperationKind,
  MAX_MEMO_TEXT_BYTES,
  MAX_TRUST_LIMIT,
  claimBalance,
  composeOperations,
  createClaimableBalance,
  createTrustline,
  describeOperation,
  familyOf,
  hashMemo,
  idMemo,
  isAccountId,
  isAmount,
  isAssetCode,
  isBalanceId,
  isNativeAsset,
  isPositiveAmount,
  isUint64,
  memoValueToBuffer,
  noMemo,
  removeTrustline,
  returnMemo,
  textMemo,
  updateTrustlineLimit,
  utf8ByteLength,
  validateOperation,
} from "../advancedOps";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ACCOUNT = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const HEX_32 = "a".repeat(64);
const BALANCE_ID = "0".repeat(72);

describe("advancedOps validation primitives", () => {
  it("accepts well-formed account ids and rejects malformed ones", () => {
    expect(isAccountId(ISSUER)).toBe(true);
    expect(isAccountId(ACCOUNT)).toBe(true);
    expect(isAccountId("GABC")).toBe(false);
    expect(isAccountId(`M${ISSUER.slice(1)}`)).toBe(false);
    expect(isAccountId(undefined)).toBe(false);
  });

  it("enforces the 1-12 character asset code range", () => {
    expect(isAssetCode("XLM")).toBe(true);
    expect(isAssetCode("a")).toBe(true);
    expect(isAssetCode("A".repeat(12))).toBe(true);
    expect(isAssetCode("A".repeat(13))).toBe(false);
    expect(isAssetCode("")).toBe(false);
    expect(isAssetCode("US-DC")).toBe(false);
  });

  it("enforces Stellar's seven decimal places on amounts", () => {
    expect(isAmount("0")).toBe(true);
    expect(isAmount("1.1234567")).toBe(true);
    expect(isAmount("1.12345678")).toBe(false);
    expect(isAmount("-1")).toBe(false);
    expect(isAmount("abc")).toBe(false);
  });

  it("distinguishes zero from a positive amount", () => {
    expect(isAmount("0")).toBe(true);
    expect(isPositiveAmount("0")).toBe(false);
    expect(isPositiveAmount("0.0000001")).toBe(true);
  });

  it("bounds memo ids to unsigned 64 bits", () => {
    expect(isUint64("0")).toBe(true);
    expect(isUint64(18446744073709551615n)).toBe(true);
    expect(isUint64(18446744073709551616n)).toBe(false);
    expect(isUint64(-1)).toBe(false);
    expect(isUint64(1.5)).toBe(false);
    expect(isUint64("not-a-number")).toBe(false);
  });

  it("recognises balance ids by their 72-character hex form", () => {
    expect(isBalanceId(BALANCE_ID)).toBe(true);
    expect(isBalanceId(HEX_32)).toBe(false);
  });

  it("measures memo length in UTF-8 bytes rather than code points", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("memo operations", () => {
  it("builds a descriptor for every memo variant", () => {
    expect(noMemo().params.kind).toBe("none");
    expect(textMemo("hello").params).toEqual({ kind: "text", value: "hello" });
    expect(idMemo(42).params).toEqual({ kind: "id", value: 42 });
    expect(hashMemo(HEX_32).params).toEqual({ kind: "hash", value: HEX_32 });
    expect(returnMemo(HEX_32).params).toEqual({ kind: "return", value: HEX_32 });
  });

  it("rejects text memos over the 28-byte limit", () => {
    const report = validateOperation(textMemo("a".repeat(MAX_MEMO_TEXT_BYTES)));
    expect(report.valid).toBe(true);

    const tooLong = validateOperation(
      textMemo("a".repeat(MAX_MEMO_TEXT_BYTES + 1))
    );
    expect(tooLong.valid).toBe(false);
    expect(tooLong.errors[0].code).toBe("MEMO_TEXT_TOO_LONG");
  });

  it("counts multi-byte characters against the byte limit", () => {
    // 15 two-byte characters is 30 bytes, over the limit, despite being
    // only 15 characters long.
    const report = validateOperation(textMemo("é".repeat(15)));
    expect(report.valid).toBe(false);
  });

  it("rejects hash memos that are not 32 bytes of hex", () => {
    const report = validateOperation(hashMemo("deadbeef"));
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("INVALID_MEMO_HASH");
  });

  it("rejects id memos outside the unsigned 64-bit range", () => {
    expect(validateOperation(idMemo("0")).valid).toBe(true);
    expect(validateOperation(idMemo("-1")).valid).toBe(false);
  });

  it("decodes hex memo values into 32-byte buffers", () => {
    const buffer = memoValueToBuffer(HEX_32);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBe(32);
  });

  it("scopes issue fields to the params object", () => {
    const report = validateOperation(hashMemo("nope"));
    expect(report.errors[0].field.startsWith("params")).toBe(true);
  });
});

describe("trustline operations", () => {
  it("builds create, update and remove descriptors", () => {
    expect(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }).kind).toBe(
      AdvancedOperationKind.TRUSTLINE_CREATE
    );
    expect(
      updateTrustlineLimit({ assetCode: "USDC", assetIssuer: ISSUER, limit: "10" })
        .kind
    ).toBe(AdvancedOperationKind.TRUSTLINE_UPDATE);
    expect(removeTrustline({ assetCode: "USDC", assetIssuer: ISSUER }).kind).toBe(
      AdvancedOperationKind.TRUSTLINE_REMOVE
    );
  });

  it("forces a zero limit when removing a trustline", () => {
    expect(removeTrustline({ assetCode: "USDC", assetIssuer: ISSUER }).params.limit).toBe(
      "0"
    );
  });

  it("rejects an invalid issuer", () => {
    const report = validateOperation(
      createTrustline({ assetCode: "USDC", assetIssuer: "not-an-account" })
    );
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "INVALID_ACCOUNT_ID")).toBe(
      true
    );
  });

  it("rejects a limit above the protocol maximum", () => {
    const report = validateOperation(
      updateTrustlineLimit({
        assetCode: "USDC",
        assetIssuer: ISSUER,
        limit: "999999999999.9999999",
      })
    );
    expect(report.valid).toBe(false);
  });

  it("accepts exactly the protocol maximum limit", () => {
    const report = validateOperation(
      updateTrustlineLimit({
        assetCode: "USDC",
        assetIssuer: ISSUER,
        limit: MAX_TRUST_LIMIT,
      })
    );
    expect(report.valid).toBe(true);
  });

  it("rejects a non-zero limit on removal", () => {
    const report = validateOperation({
      kind: AdvancedOperationKind.TRUSTLINE_REMOVE,
      params: { assetCode: "USDC", assetIssuer: ISSUER, limit: "5" },
    });
    expect(report.valid).toBe(false);
  });
});

describe("claimable balance operations", () => {
  it("treats XLM without an issuer as the native asset", () => {
    expect(isNativeAsset("XLM")).toBe(true);
    expect(isNativeAsset("XLM", "")).toBe(true);
    expect(isNativeAsset("XLM", ISSUER)).toBe(false);
    expect(isNativeAsset("USDC", ISSUER)).toBe(false);
  });

  it("validates a well-formed create", () => {
    const report = validateOperation(
      createClaimableBalance({
        assetCode: "XLM",
        amount: "10",
        claimants: [ACCOUNT],
      })
    );
    expect(report.valid).toBe(true);
  });

  it("requires at least one claimant", () => {
    const report = validateOperation(
      createClaimableBalance({ assetCode: "XLM", amount: "10", claimants: [] })
    );
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "MISSING_CLAIMANTS")).toBe(
      true
    );
  });

  it("warns about duplicate claimants without failing validation", () => {
    const report = validateOperation(
      createClaimableBalance({
        assetCode: "XLM",
        amount: "10",
        claimants: [ACCOUNT, ACCOUNT],
      })
    );
    expect(report.valid).toBe(true);
    expect(report.warnings.some((issue) => issue.code === "DUPLICATE_CLAIMANTS")).toBe(
      true
    );
  });

  it("rejects a zero amount", () => {
    const report = validateOperation(
      createClaimableBalance({
        assetCode: "XLM",
        amount: "0",
        claimants: [ACCOUNT],
      })
    );
    expect(report.valid).toBe(false);
  });

  it("requires an issuer for non-native assets", () => {
    const report = validateOperation(
      createClaimableBalance({
        assetCode: "USDC",
        amount: "10",
        claimants: [ACCOUNT],
      })
    );
    expect(report.valid).toBe(false);
  });

  it("validates a claim against the balance id format", () => {
    expect(
      validateOperation(claimBalance({ balanceId: BALANCE_ID, claimant: ACCOUNT }))
        .valid
    ).toBe(true);
    expect(
      validateOperation(claimBalance({ balanceId: "short", claimant: ACCOUNT })).valid
    ).toBe(false);
  });
});

describe("AdvancedOperationComposer", () => {
  it("maps each kind onto its family", () => {
    expect(familyOf(AdvancedOperationKind.MEMO_ATTACH)).toBe(
      AdvancedOperationFamily.MEMO
    );
    expect(familyOf(AdvancedOperationKind.TRUSTLINE_REMOVE)).toBe(
      AdvancedOperationFamily.TRUSTLINE
    );
    expect(familyOf(AdvancedOperationKind.CLAIMABLE_BALANCE_CLAIM)).toBe(
      AdvancedOperationFamily.CLAIMABLE_BALANCE
    );
  });

  it("separates the memo from ledger operations in the plan", () => {
    const plan = new AdvancedOperationComposer()
      .add(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }))
      .add(textMemo("onboarding"))
      .compose();

    expect(plan.operations).toHaveLength(1);
    expect(plan.memo?.kind).toBe(AdvancedOperationKind.MEMO_ATTACH);
    expect(plan.summary).toHaveLength(2);
  });

  it("preserves the order operations were added in", () => {
    const plan = composeOperations([
      createTrustline({ assetCode: "AAA", assetIssuer: ISSUER }),
      createTrustline({ assetCode: "BBB", assetIssuer: ISSUER }),
    ]);

    expect(plan.operations.map((op) => op.params.assetCode)).toEqual(["AAA", "BBB"]);
  });

  it("carries metadata through composition untouched", () => {
    const plan = composeOperations([
      createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }, { tag: "batch-1" }),
    ]);

    expect(plan.operations[0].metadata).toEqual({ tag: "batch-1" });
  });

  it("rejects more than one memo", () => {
    const report = new AdvancedOperationComposer()
      .add(textMemo("first"))
      .add(textMemo("second"))
      .validate();

    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "MULTIPLE_MEMOS")).toBe(true);
  });

  it("rejects an empty plan", () => {
    const report = new AdvancedOperationComposer().validate();
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "EMPTY_PLAN")).toBe(true);
  });

  it("does not count the memo against the operation ceiling", () => {
    const operations = Array.from({ length: 100 }, (_, index) =>
      createTrustline({ assetCode: `A${index}`, assetIssuer: ISSUER })
    );

    const report = new AdvancedOperationComposer(operations)
      .add(textMemo("bulk"))
      .validate();

    expect(report.valid).toBe(true);
  });

  it("rejects more than 100 ledger operations", () => {
    const operations = Array.from({ length: 101 }, (_, index) =>
      createTrustline({ assetCode: `A${index}`, assetIssuer: ISSUER })
    );

    const report = new AdvancedOperationComposer(operations).validate();
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "TOO_MANY_OPERATIONS")).toBe(
      true
    );
  });

  it("scopes issues to the offending index", () => {
    const report = new AdvancedOperationComposer()
      .add(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }))
      .add(createTrustline({ assetCode: "USDC", assetIssuer: "bad" }))
      .validate();

    expect(report.valid).toBe(false);
    expect(report.errors[0].field.startsWith("operations[1]")).toBe(true);
  });

  it("throws with every reason when composing an invalid plan", () => {
    expect(() =>
      new AdvancedOperationComposer()
        .add(createTrustline({ assetCode: "USDC", assetIssuer: "bad" }))
        .compose()
    ).toThrow(/Cannot compose operations/);
  });

  it("supports clear() and size()", () => {
    const composer = new AdvancedOperationComposer()
      .add(textMemo("a"))
      .add(noMemo());

    expect(composer.size()).toBe(2);
    expect(composer.clear().size()).toBe(0);
  });

  it("describes operations in a single readable line each", () => {
    const description = describeOperation(
      createTrustline({ assetCode: "USDC", assetIssuer: ISSUER })
    );

    expect(typeof description).toBe("string");
    expect(description).toContain("USDC");
    expect(description.includes("\n")).toBe(false);
  });

  it("reports an unknown operation kind rather than throwing", () => {
    const report = validateOperation({
      kind: "not.a.kind",
      params: {},
    } as never);

    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("UNKNOWN_OPERATION_KIND");
  });
});
