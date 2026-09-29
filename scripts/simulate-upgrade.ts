/**
 * simulate-upgrade.ts
 *
 * Loads representative state snapshots from contracts/snapshots/<contract>/<label>.snapshot.json
 * and validates that every entry in the snapshot can be decoded under the proposed schema.
 *
 * What "decode under the proposed schema" means here:
 *  - Every snapshot entry whose key_variant appears in the proposed schema must be
 *    read-compatible: same storage tier and same (or wider) value type.
 *  - Entries whose key_variant no longer exists in the proposed schema are flagged as
 *    "orphaned" — they would be silently ignored by the new code, which is safe in
 *    Soroban (the key just sits unused) but MUST be documented via a migration entry.
 *  - Entries that exist in the proposed schema but not the snapshot are simply "new"
 *    (they will be absent from chain until the new code writes them).
 *
 * The simulation does NOT execute WASM — it works purely from the canonical JSON schemas
 * and snapshot files. This makes it fast, deterministic, and runnable in CI without a
 * full Soroban sandbox.
 *
 * Exit codes:
 *   0  – simulation passed for all contracts
 *   1  – one or more contracts have incompatible or orphaned-without-migration entries
 *   2  – usage / IO error
 *
 * Usage:
 *   npx ts-node scripts/simulate-upgrade.ts \
 *     --schemas contracts/schemas \
 *     --snapshots contracts/snapshots \
 *     --migrations contracts/migrations/registry.json \
 *     --out contracts/simulation-report.json
 */

import * as fs from "fs";
import * as path from "path";
import type { ContractSchema, StorageEntry } from "./extract-storage-schema";
import type { MigrationEntry } from "./migration-registry-loader";
import { loadRegistry, findMigrationForKey } from "./migration-registry-loader";

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

export interface SnapshotEntry {
  key_variant: string;
  key_payload?: string;
  storage_tier: string;
  value_type: string;
  /** Base64-encoded serialised value for advanced tooling; optional */
  encoded_value?: string;
  /** Human-readable decoded value for readability */
  sample_value?: unknown;
}

export interface ContractSnapshot {
  contract: string;
  captured_at: string;
  /** Version of the deployed WASM this snapshot was captured from */
  wasm_version: string;
  entries: SnapshotEntry[];
}

// ---------------------------------------------------------------------------
// Simulation result types
// ---------------------------------------------------------------------------

export type EntrySimResult =
  | "compatible"
  | "orphaned_with_migration"
  | "orphaned_without_migration"
  | "type_mismatch"
  | "tier_mismatch"
  | "new_key";

export interface EntrySimDetail {
  key_variant: string;
  result: EntrySimResult;
  detail: string;
  snapshot_type?: string;
  schema_type?: string;
  migration_id?: string;
}

export interface ContractSimResult {
  contract: string;
  snapshot_label: string;
  passed: boolean;
  entries: EntrySimDetail[];
}

export interface SimulationReport {
  generated_at: string;
  overall_passed: boolean;
  contracts: ContractSimResult[];
  summary: {
    total_contracts: number;
    passed: number;
    failed: number;
    total_entries: number;
    compatible: number;
    orphaned_with_migration: number;
    orphaned_without_migration: number;
    type_mismatches: number;
    tier_mismatches: number;
    new_keys: number;
  };
}

// ---------------------------------------------------------------------------
// Core simulation
// ---------------------------------------------------------------------------

function normType(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

export function simulateContract(
  schema: ContractSchema,
  snapshot: ContractSnapshot,
  migrations: MigrationEntry[]
): ContractSimResult {
  const schemaMap = new Map<string, StorageEntry>(
    schema.data_key_variants.map((e) => [e.key_variant, e])
  );

  const details: EntrySimDetail[] = [];

  // 1. Check every snapshot entry against the proposed schema
  for (const snap of snapshot.entries) {
    const schemaEntry = schemaMap.get(snap.key_variant);

    if (!schemaEntry) {
      // Key was removed or renamed in proposed schema
      const migration = findMigrationForKey(
        { registry_version: "1.0.0", updated_at: "", migrations },
        schema.contract,
        snap.key_variant
      );
      details.push({
        key_variant: snap.key_variant,
        result: migration ? "orphaned_with_migration" : "orphaned_without_migration",
        detail: migration
          ? `Key removed in proposed schema; migration '${migration.id}' covers this change`
          : `Key '${snap.key_variant}' exists in live state but is absent from the proposed schema — state will be silently orphaned. Declare a migration to make this intentional.`,
        snapshot_type: snap.value_type,
        migration_id: migration?.id,
      });
      continue;
    }

    // Storage tier mismatch
    if (
      snap.storage_tier !== "unknown" &&
      schemaEntry.storage_tier !== "unknown" &&
      snap.storage_tier !== schemaEntry.storage_tier
    ) {
      const migration = findMigrationForKey(
        { registry_version: "1.0.0", updated_at: "", migrations },
        schema.contract,
        snap.key_variant
      );
      details.push({
        key_variant: snap.key_variant,
        result: "tier_mismatch",
        detail: migration
          ? `Tier moved from ${snap.storage_tier} to ${schemaEntry.storage_tier}; migration '${migration.id}' declared`
          : `Tier changed from ${snap.storage_tier} to ${schemaEntry.storage_tier} — existing state in ${snap.storage_tier} will not be found`,
        snapshot_type: snap.value_type,
        schema_type: schemaEntry.value_type,
        migration_id: migration?.id,
      });
      continue;
    }

    // Value type mismatch
    if (
      snap.value_type !== "unknown" &&
      schemaEntry.value_type !== "unknown" &&
      normType(snap.value_type) !== normType(schemaEntry.value_type)
    ) {
      const migration = findMigrationForKey(
        { registry_version: "1.0.0", updated_at: "", migrations },
        schema.contract,
        snap.key_variant
      );
      details.push({
        key_variant: snap.key_variant,
        result: "type_mismatch",
        detail: migration
          ? `Type changed from '${snap.value_type}' to '${schemaEntry.value_type}'; migration '${migration.id}' declared`
          : `Type changed from '${snap.value_type}' to '${schemaEntry.value_type}' — deserialisation will corrupt state`,
        snapshot_type: snap.value_type,
        schema_type: schemaEntry.value_type,
        migration_id: migration?.id,
      });
      continue;
    }

    // All good
    details.push({
      key_variant: snap.key_variant,
      result: "compatible",
      detail: `Key '${snap.key_variant}' (${schemaEntry.storage_tier}, ${schemaEntry.value_type}) is compatible`,
    });
  }

  // 2. New schema keys not in snapshot — informational only
  for (const schemaEntry of schema.data_key_variants) {
    if (!snapshot.entries.some((e) => e.key_variant === schemaEntry.key_variant)) {
      details.push({
        key_variant: schemaEntry.key_variant,
        result: "new_key",
        detail: `Key '${schemaEntry.key_variant}' is new in proposed schema — no existing state to migrate`,
        schema_type: schemaEntry.value_type,
      });
    }
  }

  const failed =
    details.some((d) =>
      d.result === "orphaned_without_migration" ||
      (d.result === "type_mismatch" && !d.migration_id) ||
      (d.result === "tier_mismatch" && !d.migration_id)
    );

  return {
    contract: schema.contract,
    snapshot_label: snapshot.captured_at,
    passed: !failed,
    entries: details,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function loadSchema(p: string): ContractSchema {
  return JSON.parse(fs.readFileSync(p, "utf8")) as ContractSchema;
}

function loadSnapshot(p: string): ContractSnapshot {
  return JSON.parse(fs.readFileSync(p, "utf8")) as ContractSnapshot;
}

function main() {
  const args = process.argv.slice(2);
  let schemasDir = path.join(process.cwd(), "contracts", "schemas");
  let snapshotsDir = path.join(process.cwd(), "contracts", "snapshots");
  let migrationsPath = path.join(process.cwd(), "contracts", "migrations", "registry.json");
  let outPath = path.join(process.cwd(), "contracts", "simulation-report.json");
  let contractFilter: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--schemas") schemasDir = args[++i];
    else if (args[i] === "--snapshots") snapshotsDir = args[++i];
    else if (args[i] === "--migrations") migrationsPath = args[++i];
    else if (args[i] === "--out") outPath = args[++i];
    else if (args[i] === "--contract") contractFilter = args[++i];
  }

  const registry = loadRegistry(migrationsPath);
  const migrations = registry.migrations;
  const results: ContractSimResult[] = [];

  // Enumerate all schema files
  if (!fs.existsSync(schemasDir)) {
    console.error(`Schemas directory not found: ${schemasDir}`);
    process.exit(2);
  }

  const schemaFiles = fs
    .readdirSync(schemasDir)
    .filter((f) => f.endsWith(".schema.json"))
    .filter((f) => !contractFilter || f === `${contractFilter}.schema.json`);

  for (const schemaFile of schemaFiles) {
    const contractName = schemaFile.replace(".schema.json", "");
    const schema = loadSchema(path.join(schemasDir, schemaFile));

    const contractSnapshotDir = path.join(snapshotsDir, contractName);
    if (!fs.existsSync(contractSnapshotDir)) {
      console.log(`⚠  ${contractName}: no snapshots directory found — skipping simulation`);
      continue;
    }

    const snapshotFiles = fs
      .readdirSync(contractSnapshotDir)
      .filter((f) => f.endsWith(".snapshot.json"));

    if (snapshotFiles.length === 0) {
      console.log(`⚠  ${contractName}: no snapshot files found — skipping simulation`);
      continue;
    }

    for (const snapshotFile of snapshotFiles) {
      const snapshot = loadSnapshot(path.join(contractSnapshotDir, snapshotFile));
      const result = simulateContract(schema, snapshot, migrations);
      results.push(result);
    }
  }

  const summary = {
    total_contracts: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    total_entries: results.reduce((s, r) => s + r.entries.length, 0),
    compatible: results.reduce((s, r) => s + r.entries.filter((e) => e.result === "compatible").length, 0),
    orphaned_with_migration: results.reduce(
      (s, r) => s + r.entries.filter((e) => e.result === "orphaned_with_migration").length,
      0
    ),
    orphaned_without_migration: results.reduce(
      (s, r) => s + r.entries.filter((e) => e.result === "orphaned_without_migration").length,
      0
    ),
    type_mismatches: results.reduce(
      (s, r) => s + r.entries.filter((e) => e.result === "type_mismatch").length,
      0
    ),
    tier_mismatches: results.reduce(
      (s, r) => s + r.entries.filter((e) => e.result === "tier_mismatch").length,
      0
    ),
    new_keys: results.reduce(
      (s, r) => s + r.entries.filter((e) => e.result === "new_key").length,
      0
    ),
  };

  const report: SimulationReport = {
    generated_at: new Date().toISOString(),
    overall_passed: summary.failed === 0,
    contracts: results,
    summary,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  // Human-readable output
  console.log(`\nUpgrade Simulation Report`);
  console.log(`${"─".repeat(60)}`);
  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    const failures = r.entries.filter(
      (e) =>
        e.result === "orphaned_without_migration" ||
        (e.result === "type_mismatch" && !e.migration_id) ||
        (e.result === "tier_mismatch" && !e.migration_id)
    );
    if (failures.length === 0) {
      console.log(`${icon}  ${r.contract}: simulation passed (${r.entries.length} entries checked)`);
    } else {
      console.log(`${icon}  ${r.contract}: ${failures.length} issue(s)`);
      for (const e of failures) {
        console.log(`     🔴 [${e.key_variant}] ${e.detail}`);
      }
    }
  }
  console.log(`${"─".repeat(60)}`);
  console.log(`Overall: ${report.overall_passed ? "PASSED" : "FAILED"}`);
  console.log(`Contracts: ${summary.passed} passed / ${summary.failed} failed`);
  console.log(`Report written to ${path.relative(process.cwd(), outPath)}\n`);

  process.exit(report.overall_passed ? 0 : 1);
}

if (require.main === module) {
  main();
}
