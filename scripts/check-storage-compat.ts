/**
 * check-storage-compat.ts
 *
 * Compares a "proposed" schema against a "baseline" (deployed) schema for every
 * contract listed in the release manifest (or all contracts in the schemas dir)
 * and classifies each storage-key change as one of:
 *
 *   compatible          – adding a new key, or changing TTL only
 *   requires_migration  – value-type change or storage-tier change that has a
 *                         matching entry in the migration registry
 *   breaking            – value-type change, tier change, key removal, or key
 *                         rename without a registered migration
 *
 * Exit codes:
 *   0  – all changes are compatible or have registered migrations
 *   1  – one or more breaking changes detected
 *   2  – usage / IO error
 *
 * Usage:
 *   npx ts-node scripts/check-storage-compat.ts \
 *     --baseline contracts/schemas \
 *     --proposed contracts/schemas \
 *     --migrations contracts/migrations/registry.json \
 *     --out contracts/compat-report.json
 */

import * as fs from "fs";
import * as path from "path";
import type { ContractSchema, StorageEntry, StorageTier } from "./extract-storage-schema";
import type { MigrationEntry } from "./migration-registry-loader";

// ---------------------------------------------------------------------------
// Result types (consumed by validate-release-manifest.ts and CI)
// ---------------------------------------------------------------------------

export type ChangeClass = "compatible" | "requires_migration" | "breaking";

export type ChangeReason =
  | "key_added"
  | "key_removed"
  | "value_type_changed"
  | "storage_tier_changed"
  | "ttl_changed"
  | "key_payload_changed"
  | "migration_declared";

export interface KeyChange {
  key_variant: string;
  classification: ChangeClass;
  reason: ChangeReason;
  detail: string;
  baseline?: Partial<StorageEntry>;
  proposed?: Partial<StorageEntry>;
  migration_id?: string;
}

export interface ContractCompatResult {
  contract: string;
  baseline_version: string;
  proposed_version: string;
  has_breaking: boolean;
  has_requires_migration: boolean;
  changes: KeyChange[];
}

export interface CompatReport {
  generated_at: string;
  overall_status: "pass" | "fail";
  contracts: ContractCompatResult[];
  summary: {
    total_contracts: number;
    contracts_with_breaking: number;
    contracts_clean: number;
    total_breaking: number;
    total_requires_migration: number;
    total_compatible: number;
  };
}

// ---------------------------------------------------------------------------
// Comparison logic
// ---------------------------------------------------------------------------

function normType(t: string): string {
  // Collapse whitespace for reliable comparison
  return t.replace(/\s+/g, " ").trim();
}

function lookupMigration(
  migrations: MigrationEntry[],
  contract: string,
  keyVariant: string
): MigrationEntry | undefined {
  return migrations.find(
    (m) =>
      m.contract === contract &&
      m.storageChanges.some((sc) => sc.keyVariant === keyVariant)
  );
}

export function compareSchemas(
  baseline: ContractSchema,
  proposed: ContractSchema,
  migrations: MigrationEntry[]
): ContractCompatResult {
  const changes: KeyChange[] = [];

  const baselineMap = new Map<string, StorageEntry>(
    baseline.data_key_variants.map((e) => [e.key_variant, e])
  );
  const proposedMap = new Map<string, StorageEntry>(
    proposed.data_key_variants.map((e) => [e.key_variant, e])
  );

  // Keys present in baseline but removed in proposed
  for (const [key, base] of baselineMap) {
    if (!proposedMap.has(key)) {
      const migration = lookupMigration(migrations, proposed.contract, key);
      changes.push({
        key_variant: key,
        classification: migration ? "requires_migration" : "breaking",
        reason: migration ? "migration_declared" : "key_removed",
        detail: migration
          ? `Key removed; migration '${migration.id}' declared (${migration.description})`
          : `Key '${key}' present in baseline but absent in proposed schema — this is a breaking removal`,
        baseline: { key_variant: base.key_variant, value_type: base.value_type, storage_tier: base.storage_tier },
        migration_id: migration?.id,
      });
    }
  }

  // Keys present in proposed — new or changed
  for (const [key, prop] of proposedMap) {
    const base = baselineMap.get(key);

    if (!base) {
      // New key — always compatible
      changes.push({
        key_variant: key,
        classification: "compatible",
        reason: "key_added",
        detail: `New key '${key}' (${prop.storage_tier}, ${prop.value_type}) — no existing state to corrupt`,
        proposed: { key_variant: prop.key_variant, value_type: prop.value_type, storage_tier: prop.storage_tier },
      });
      continue;
    }

    const subChanges: KeyChange[] = [];

    // 1. Value type change
    if (
      normType(base.value_type) !== normType(prop.value_type) &&
      base.value_type !== "unknown" &&
      prop.value_type !== "unknown"
    ) {
      const migration = lookupMigration(migrations, proposed.contract, key);
      subChanges.push({
        key_variant: key,
        classification: migration ? "requires_migration" : "breaking",
        reason: migration ? "migration_declared" : "value_type_changed",
        detail: migration
          ? `Value type changed from '${base.value_type}' to '${prop.value_type}'; migration '${migration.id}' declared`
          : `Value type changed from '${base.value_type}' to '${prop.value_type}' — existing encoded values will be misread`,
        baseline: { value_type: base.value_type },
        proposed: { value_type: prop.value_type },
        migration_id: migration?.id,
      });
    }

    // 2. Storage tier change
    if (
      base.storage_tier !== "unknown" &&
      prop.storage_tier !== "unknown" &&
      base.storage_tier !== prop.storage_tier
    ) {
      const migration = lookupMigration(migrations, proposed.contract, key);
      subChanges.push({
        key_variant: key,
        classification: migration ? "requires_migration" : "breaking",
        reason: migration ? "migration_declared" : "storage_tier_changed",
        detail: migration
          ? `Storage tier changed from ${base.storage_tier} to ${prop.storage_tier}; migration '${migration.id}' declared`
          : `Storage tier changed from ${base.storage_tier} to ${prop.storage_tier} — key will not be found in the new tier`,
        baseline: { storage_tier: base.storage_tier },
        proposed: { storage_tier: prop.storage_tier },
        migration_id: migration?.id,
      });
    }

    // 3. Key payload type change (parameterised keys)
    if (
      base.key_payload !== undefined &&
      prop.key_payload !== undefined &&
      normType(base.key_payload) !== normType(prop.key_payload)
    ) {
      const migration = lookupMigration(migrations, proposed.contract, key);
      subChanges.push({
        key_variant: key,
        classification: migration ? "requires_migration" : "breaking",
        reason: migration ? "migration_declared" : "key_payload_changed",
        detail: migration
          ? `Key payload changed from '${base.key_payload}' to '${prop.key_payload}'; migration '${migration.id}' declared`
          : `Key payload type changed from '${base.key_payload}' to '${prop.key_payload}' — existing keys will not be located`,
        baseline: { key_payload: base.key_payload },
        proposed: { key_payload: prop.key_payload },
        migration_id: migration?.id,
      });
    }

    // 4. TTL change — compatible by itself (data survives), flag for visibility
    if (base.ttl !== prop.ttl) {
      subChanges.push({
        key_variant: key,
        classification: "compatible",
        reason: "ttl_changed",
        detail: `TTL changed from '${base.ttl ?? "none"}' to '${prop.ttl ?? "none"}' — existing entries keep their old TTL until next touch`,
        baseline: { ttl: base.ttl },
        proposed: { ttl: prop.ttl },
      });
    }

    if (subChanges.length === 0) {
      // Completely unchanged — no entry in output (keeps report clean)
    } else {
      changes.push(...subChanges);
    }
  }

  const hasBreaking = changes.some((c) => c.classification === "breaking");
  const hasMigration = changes.some((c) => c.classification === "requires_migration");

  return {
    contract: proposed.contract,
    baseline_version: baseline.schema_version,
    proposed_version: proposed.schema_version,
    has_breaking: hasBreaking,
    has_requires_migration: hasMigration,
    changes,
  };
}

// ---------------------------------------------------------------------------
// Schema loader helpers
// ---------------------------------------------------------------------------

function loadSchema(schemaPath: string): ContractSchema {
  const raw = fs.readFileSync(schemaPath, "utf8");
  return JSON.parse(raw) as ContractSchema;
}

function loadMigrations(registryPath: string): MigrationEntry[] {
  if (!fs.existsSync(registryPath)) return [];
  const raw = fs.readFileSync(registryPath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.migrations ?? []);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let baselineDir = path.join(process.cwd(), "contracts", "schemas");
  let proposedDir = path.join(process.cwd(), "contracts", "schemas");
  let migrationsPath = path.join(process.cwd(), "contracts", "migrations", "registry.json");
  let outPath = path.join(process.cwd(), "contracts", "compat-report.json");
  let contractFilter: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline") baselineDir = args[++i];
    else if (args[i] === "--proposed") proposedDir = args[++i];
    else if (args[i] === "--migrations") migrationsPath = args[++i];
    else if (args[i] === "--out") outPath = args[++i];
    else if (args[i] === "--contract") contractFilter = args[++i];
  }

  const migrations = loadMigrations(migrationsPath);

  // Collect all schema files that exist in BOTH dirs
  const baselineFiles = new Set(
    fs.readdirSync(baselineDir).filter((f) => f.endsWith(".schema.json"))
  );
  const proposedFiles = new Set(
    fs.readdirSync(proposedDir).filter((f) => f.endsWith(".schema.json"))
  );
  const allFiles = [...proposedFiles].filter((f) => {
    if (contractFilter) return f === `${contractFilter}.schema.json`;
    return true;
  });

  const results: ContractCompatResult[] = [];

  for (const file of allFiles) {
    const contractName = file.replace(".schema.json", "");
    const proposedSchema = loadSchema(path.join(proposedDir, file));

    if (!baselineFiles.has(file)) {
      // Brand-new contract — all keys are additions, always compatible
      const syntheticBaseline: ContractSchema = {
        ...proposedSchema,
        data_key_variants: [],
        contract_types: [],
        ttl_constants: {},
        extracted_at: "",
      };
      results.push(compareSchemas(syntheticBaseline, proposedSchema, migrations));
      continue;
    }

    const baselineSchema = loadSchema(path.join(baselineDir, file));
    results.push(compareSchemas(baselineSchema, proposedSchema, migrations));
  }

  const breakingContracts = results.filter((r) => r.has_breaking);
  const report: CompatReport = {
    generated_at: new Date().toISOString(),
    overall_status: breakingContracts.length > 0 ? "fail" : "pass",
    contracts: results,
    summary: {
      total_contracts: results.length,
      contracts_with_breaking: breakingContracts.length,
      contracts_clean: results.filter((r) => !r.has_breaking && !r.has_requires_migration).length,
      total_breaking: results.reduce((s, r) => s + r.changes.filter((c) => c.classification === "breaking").length, 0),
      total_requires_migration: results.reduce(
        (s, r) => s + r.changes.filter((c) => c.classification === "requires_migration").length,
        0
      ),
      total_compatible: results.reduce(
        (s, r) => s + r.changes.filter((c) => c.classification === "compatible").length,
        0
      ),
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  // Human-readable summary
  console.log(`\nStorage Compatibility Report`);
  console.log(`${"─".repeat(60)}`);
  for (const r of results) {
    const icon = r.has_breaking ? "✗" : r.has_requires_migration ? "⚠" : "✓";
    if (r.changes.length === 0) {
      console.log(`${icon}  ${r.contract}: no storage changes`);
      continue;
    }
    console.log(`${icon}  ${r.contract}:`);
    for (const c of r.changes) {
      const prefix =
        c.classification === "breaking" ? "  🔴 BREAKING" :
        c.classification === "requires_migration" ? "  🟡 MIGRATION" :
        "  🟢 compatible";
      console.log(`${prefix} [${c.key_variant}] ${c.detail}`);
    }
  }
  console.log(`${"─".repeat(60)}`);
  console.log(`Status: ${report.overall_status.toUpperCase()}`);
  console.log(`Breaking: ${report.summary.total_breaking} | Migration: ${report.summary.total_requires_migration} | Compatible: ${report.summary.total_compatible}`);
  console.log(`Report written to ${path.relative(process.cwd(), outPath)}\n`);

  process.exit(report.overall_status === "fail" ? 1 : 0);
}

export { loadSchema, loadMigrations, compareSchemas as checkCompat };

if (require.main === module) {
  main();
}
