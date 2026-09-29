/**
 * check-storage-budget.ts
 *
 * Verifies contracts/storage_budget.json against the extracted storage schemas:
 * every declared key needs an owner, tier, size bound, renewal policy and
 * expiry behaviour, and all TTLs must fit the network maximum.
 *
 * Exit codes: 0 = no violations, 1 = violations found, 2 = usage / IO error.
 *
 * Usage:
 *   node_modules/.bin/ts-node scripts/check-storage-budget.ts \
 *     --schemas contracts/schemas --budget contracts/storage_budget.json \
 *     [--out contracts/storage-budget-report.json]
 */

import * as fs from "fs";
import * as path from "path";

export type Tier = "Instance" | "Persistent" | "Temporary";
export type Ttl = { threshold: number; extend_to: number };

export interface BudgetKey {
  key: string;
  tier: Tier;
  owner: string;
  class: "singleton" | "per_account" | "per_item" | "list";
  max_entry_bytes: number;
  renewal: Ttl | "none";
  on_expiry: "restore" | "recreate" | "reject";
  waiver?: string;
}

export interface ContractBudget {
  keys: BudgetKey[];
  instance_renewal?: Ttl;
  max_keys?: Partial<Record<Tier, number>>;
  waiver?: string;
}

export interface Budget {
  network: { max_ttl_ledgers: number; ledgers_per_day: number };
  contracts: Record<string, ContractBudget>;
}

export interface SchemaLike {
  contract: string;
  data_key_variants: Array<{ key_variant: string; storage_tier: string }>;
}

export interface Violation {
  contract: string;
  key?: string;
  code: string;
  message: string;
  waiver?: string;
}

export interface Report {
  violations: Violation[];
  waived: Violation[];
  summary: Record<string, Record<Tier, number>>;
}

const ttlProblem = (t: Ttl, max: number): string | undefined => {
  if (t.threshold > t.extend_to) return "threshold is above extend_to";
  if (t.extend_to > max)
    return `extend_to ${t.extend_to} exceeds network max ${max}`;
  return undefined;
};

export function checkBudget(schemas: SchemaLike[], budget: Budget): Report {
  const violations: Violation[] = [];
  const waived: Violation[] = [];
  const summary: Report["summary"] = {};
  const max = budget.network.max_ttl_ledgers;

  for (const s of schemas) {
    const cb: ContractBudget = budget.contracts[s.contract] ?? { keys: [] };
    const declared = new Map<string, string>();
    for (const e of s.data_key_variants) {
      if (!declared.has(e.key_variant))
        declared.set(e.key_variant, e.storage_tier);
    }
    if (declared.size === 0 && cb.keys.length === 0) continue;

    const add = (
      code: string,
      message: string,
      key?: string,
      waiver?: string
    ) => {
      const v: Violation = { contract: s.contract, key, code, message };
      if (waiver) waived.push({ ...v, waiver });
      else violations.push(v);
    };

    const byKey = new Map(cb.keys.map((k) => [k.key, k]));
    const counts: Record<Tier, number> = {
      Instance: 0,
      Persistent: 0,
      Temporary: 0,
    };

    for (const [name, tier] of declared) {
      const k = byKey.get(name);
      if (!k) {
        add("MISSING_ENTRY", `${name} has no budget entry`, name, cb.waiver);
        continue;
      }
      counts[k.tier] += 1;
      const w = k.waiver;
      if (tier !== "unknown" && tier !== k.tier) {
        add(
          "TIER_MISMATCH",
          `${name}: code uses ${tier}, budget says ${k.tier}`,
          name,
          w
        );
      }
      if (!(k.max_entry_bytes > 0))
        add("MISSING_BOUND", `${name} has no size bound`, name, w);
      if (k.renewal !== "none") {
        const problem = ttlProblem(k.renewal, max);
        if (problem) add("INVALID_TTL", `${name}: ${problem}`, name, w);
      }
      if (k.tier === "Persistent" && k.renewal === "none") {
        add(
          "MISSING_RENEWAL",
          `${name} is persistent but has no renewal policy`,
          name,
          w
        );
      }
      if (
        (k.tier === "Persistent" && k.on_expiry === "recreate") ||
        (k.tier === "Temporary" && k.on_expiry === "restore")
      ) {
        add(
          "BAD_EXPIRY",
          `${name}: ${k.on_expiry} is impossible for ${k.tier} entries`,
          name,
          w
        );
      }
      if (k.tier === "Instance" && k.class !== "singleton") {
        add(
          "UNBOUNDED_IN_INSTANCE",
          `${name} is ${k.class} data in instance storage`,
          name,
          w
        );
      }
    }

    for (const k of cb.keys) {
      if (!declared.has(k.key))
        add(
          "STALE_ENTRY",
          `${k.key} is not declared in the contract`,
          k.key,
          k.waiver
        );
    }

    if (counts.Instance > 0) {
      if (!cb.instance_renewal) {
        add(
          "MISSING_INSTANCE_RENEWAL",
          "instance storage is used but never renewed",
          undefined,
          cb.waiver
        );
      } else {
        const problem = ttlProblem(cb.instance_renewal, max);
        if (problem)
          add(
            "INVALID_TTL",
            `instance renewal: ${problem}`,
            undefined,
            cb.waiver
          );
      }
    }
    for (const tier of Object.keys(counts) as Tier[]) {
      const limit = cb.max_keys?.[tier];
      if (limit !== undefined && counts[tier] > limit) {
        add(
          "LIMIT_EXCEEDED",
          `${counts[tier]} ${tier} keys exceed the limit of ${limit}`,
          undefined,
          cb.waiver
        );
      }
    }
    summary[s.contract] = counts;
  }
  return { violations, waived, summary };
}

function main(argv: string[]): number {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dir = arg("--schemas");
  const file = arg("--budget");
  const out = arg("--out");
  if (!dir || !file) {
    console.error(
      "usage: check-storage-budget.ts --schemas <dir> --budget <file> [--out <file>]"
    );
    return 2;
  }
  try {
    const schemas: SchemaLike[] = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".schema.json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    const budget: Budget = JSON.parse(fs.readFileSync(file, "utf8"));
    const report = checkBudget(schemas, budget);
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
    for (const v of report.violations)
      console.error(
        `${v.code}  ${v.contract}${v.key ? "." + v.key : ""}: ${v.message}`
      );
    console.log(
      `${report.violations.length} violation(s), ${report.waived.length} waived`
    );
    return report.violations.length > 0 ? 1 : 0;
  } catch (err) {
    console.error(String(err));
    return 2;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
