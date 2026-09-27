import {
  checkBudget,
  Budget,
  SchemaLike,
} from "../../scripts/check-storage-budget";

const NETWORK = { max_ttl_ledgers: 3_000_000, ledgers_per_day: 17_280 };

const schemas = (...keys: Array<[string, string]>): SchemaLike[] => [
  {
    contract: "vault",
    data_key_variants: keys.map(([key_variant, storage_tier]) => ({
      key_variant,
      storage_tier,
    })),
  },
];

const okKey = (over: Record<string, unknown> = {}) => ({
  key: "Deposit",
  tier: "Persistent",
  owner: "deposit",
  class: "per_account",
  max_entry_bytes: 128,
  renewal: { threshold: 100_000, extend_to: 500_000 },
  on_expiry: "restore",
  ...over,
});

const budget = (
  keys: unknown[],
  contract: Record<string, unknown> = {}
): Budget =>
  ({
    network: NETWORK,
    contracts: { vault: { keys, ...contract } },
  }) as unknown as Budget;

const codes = (r: { violations: Array<{ code: string }> }) =>
  r.violations.map((v) => v.code);

describe("checkBudget", () => {
  it("passes when every key has a valid policy", () => {
    const r = checkBudget(
      schemas(["Deposit", "Persistent"]),
      budget([okKey()])
    );
    expect(codes(r)).toEqual([]);
  });

  it("flags a declared key with no manifest entry", () => {
    const r = checkBudget(schemas(["Deposit", "Persistent"]), budget([]));
    expect(codes(r)).toEqual(["MISSING_ENTRY"]);
  });

  it("flags a manifest entry that matches no declared key", () => {
    const r = checkBudget(schemas(), budget([okKey()]));
    expect(codes(r)).toEqual(["STALE_ENTRY"]);
  });

  it("flags a tier mismatch but accepts an unknown extractor tier", () => {
    const bad = checkBudget(
      schemas(["Deposit", "Instance"]),
      budget([okKey()])
    );
    expect(codes(bad)).toContain("TIER_MISMATCH");
    const unknown = checkBudget(
      schemas(["Deposit", "unknown"]),
      budget([okKey()])
    );
    expect(codes(unknown)).toEqual([]);
  });

  it("rejects a TTL above the network maximum or a threshold above the target", () => {
    const tooLong = okKey({
      renewal: { threshold: 1_000, extend_to: 3_000_001 },
    });
    expect(
      codes(checkBudget(schemas(["Deposit", "Persistent"]), budget([tooLong])))
    ).toEqual(["INVALID_TTL"]);
    const inverted = okKey({ renewal: { threshold: 9_000, extend_to: 1_000 } });
    expect(
      codes(checkBudget(schemas(["Deposit", "Persistent"]), budget([inverted])))
    ).toEqual(["INVALID_TTL"]);
  });

  it("requires a renewal policy for persistent keys", () => {
    const r = checkBudget(
      schemas(["Deposit", "Persistent"]),
      budget([okKey({ renewal: "none" })])
    );
    expect(codes(r)).toEqual(["MISSING_RENEWAL"]);
  });

  it("rejects impossible expiry behaviour", () => {
    const persistent = okKey({ on_expiry: "recreate" });
    expect(
      codes(
        checkBudget(schemas(["Deposit", "Persistent"]), budget([persistent]))
      )
    ).toEqual(["BAD_EXPIRY"]);
    const temp = okKey({
      key: "Nonce",
      tier: "Temporary",
      renewal: "none",
      on_expiry: "restore",
    });
    expect(
      codes(checkBudget(schemas(["Nonce", "Temporary"]), budget([temp])))
    ).toEqual(["BAD_EXPIRY"]);
  });

  it("requires instance renewal when a contract uses instance storage", () => {
    const cfg = okKey({
      key: "Config",
      tier: "Instance",
      class: "singleton",
      renewal: "none",
      on_expiry: "restore",
    });
    const r = checkBudget(schemas(["Config", "Instance"]), budget([cfg]));
    expect(codes(r)).toEqual(["MISSING_INSTANCE_RENEWAL"]);
    const fixed = budget([cfg], {
      instance_renewal: { threshold: 100_000, extend_to: 500_000 },
    });
    expect(codes(checkBudget(schemas(["Config", "Instance"]), fixed))).toEqual(
      []
    );
  });

  it("flags per-account data kept in instance storage", () => {
    const k = okKey({ key: "Role", tier: "Instance", renewal: "none" });
    const b = budget([k], { instance_renewal: { threshold: 1, extend_to: 2 } });
    expect(codes(checkBudget(schemas(["Role", "Instance"]), b))).toEqual([
      "UNBOUNDED_IN_INSTANCE",
    ]);
  });

  it("requires a positive size bound", () => {
    const r = checkBudget(
      schemas(["Deposit", "Persistent"]),
      budget([okKey({ max_entry_bytes: 0 })])
    );
    expect(codes(r)).toEqual(["MISSING_BOUND"]);
  });

  it("enforces per-tier key limits", () => {
    const two = [okKey(), okKey({ key: "ForceExit" })];
    const b = budget(two, { max_keys: { Persistent: 1 } });
    expect(
      codes(
        checkBudget(
          schemas(["Deposit", "Persistent"], ["ForceExit", "Persistent"]),
          b
        )
      )
    ).toEqual(["LIMIT_EXCEEDED"]);
  });

  it("reports waived violations separately and counts duplicate keys once", () => {
    const waived = okKey({ renewal: "none", waiver: "fix tracked separately" });
    const r = checkBudget(
      schemas(["Deposit", "Persistent"], ["Deposit", "Persistent"]),
      budget([waived])
    );
    expect(r.violations).toEqual([]);
    expect(r.waived.map((v) => v.code)).toEqual(["MISSING_RENEWAL"]);
  });
});
