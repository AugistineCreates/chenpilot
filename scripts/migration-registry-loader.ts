/**
 * migration-registry-loader.ts
 *
 * Typed loader for contracts/migrations/registry.json.
 * Imported by check-storage-compat.ts, validate-release-manifest.ts, and tests.
 *
 * The registry is the single authoritative record of intentional storage
 * changes. An entry here tells the compatibility checker "yes, this key's
 * shape changed on purpose and we have a migration that handles existing state."
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What kind of storage change this migration handles */
export type MigrationChangeKind =
  | "value_type_changed"
  | "storage_tier_changed"
  | "key_removed"
  | "key_renamed"
  | "key_payload_changed"
  | "schema_init"          // first-time schema, no prior state
  | "ttl_changed";

export interface StorageChangeDescriptor {
  keyVariant: string;
  kind: MigrationChangeKind;
  /** Human-readable description of what the value or key shape changed to/from */
  description: string;
  /** Rust type before the change (omit for new keys) */
  from_type?: string;
  /** Rust type after the change */
  to_type?: string;
}

export interface MigrationEntry {
  /** Globally unique identifier. Format: <contract>/<fromVersion>→<toVersion>/<slug> */
  id: string;
  /** Contract this migration applies to */
  contract: string;
  /** Semver of the deployed baseline this migration runs from */
  fromVersion: string;
  /** Semver of the proposed WASM this migration upgrades to */
  toVersion: string;
  /** Human description of what changed and why */
  description: string;
  /**
   * Idempotency key — a deterministic string derived from contract + id.
   * Re-running the migration with the same key must be a no-op.
   */
  idempotencyKey: string;
  /** List of storage-key changes this migration addresses */
  storageChanges: StorageChangeDescriptor[];
  /**
   * Optional Soroban admin operation to invoke as part of the migration
   * (e.g. a contract-level `migrate()` entry-point). Purely declarative —
   * actual invocation is handled by the upgrade tooling.
   */
  migrationInvocation?: {
    functionName: string;
    args?: string[];
  };
  /** ISO-8601 date this entry was authored */
  authored_at: string;
  /** GitHub PR or issue reference for audit trail */
  reference?: string;
}

export interface MigrationRegistry {
  registry_version: string;
  updated_at: string;
  migrations: MigrationEntry[];
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const DEFAULT_PATH = path.join(process.cwd(), "contracts", "migrations", "registry.json");

export function loadRegistry(registryPath = DEFAULT_PATH): MigrationRegistry {
  if (!fs.existsSync(registryPath)) {
    return { registry_version: "1.0.0", updated_at: new Date().toISOString(), migrations: [] };
  }
  const raw = fs.readFileSync(registryPath, "utf8");
  const parsed = JSON.parse(raw) as MigrationRegistry;
  if (!Array.isArray(parsed.migrations)) {
    throw new Error(`Migration registry at ${registryPath} is missing 'migrations' array`);
  }
  return parsed;
}

export function getMigrationsForContract(
  registry: MigrationRegistry,
  contract: string
): MigrationEntry[] {
  return registry.migrations.filter((m) => m.contract === contract);
}

export function getMigrationById(registry: MigrationRegistry, id: string): MigrationEntry | undefined {
  return registry.migrations.find((m) => m.id === id);
}

/**
 * Returns the migration that covers a specific storage key change for a contract,
 * or undefined if no such migration is registered.
 */
export function findMigrationForKey(
  registry: MigrationRegistry,
  contract: string,
  keyVariant: string
): MigrationEntry | undefined {
  return registry.migrations.find(
    (m) =>
      m.contract === contract &&
      m.storageChanges.some((sc) => sc.keyVariant === keyVariant)
  );
}

/**
 * Validate registry entries for structural correctness.
 * Returns a list of validation errors (empty = valid).
 */
export function validateRegistry(registry: MigrationRegistry): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenIdempotencyKeys = new Set<string>();

  for (const m of registry.migrations) {
    // Required fields
    if (!m.id) errors.push(`Migration missing 'id'`);
    if (!m.contract) errors.push(`Migration '${m.id}' missing 'contract'`);
    if (!m.fromVersion) errors.push(`Migration '${m.id}' missing 'fromVersion'`);
    if (!m.toVersion) errors.push(`Migration '${m.id}' missing 'toVersion'`);
    if (!m.idempotencyKey) errors.push(`Migration '${m.id}' missing 'idempotencyKey'`);
    if (!Array.isArray(m.storageChanges) || m.storageChanges.length === 0) {
      errors.push(`Migration '${m.id}' has no storageChanges`);
    }

    // Uniqueness
    if (seenIds.has(m.id)) errors.push(`Duplicate migration id: '${m.id}'`);
    seenIds.add(m.id);

    if (seenIdempotencyKeys.has(m.idempotencyKey)) {
      errors.push(`Duplicate idempotencyKey: '${m.idempotencyKey}' (migration '${m.id}')`);
    }
    seenIdempotencyKeys.add(m.idempotencyKey);

    // IdempotencyKey must encode contract + id
    const expectedKey = `${m.contract}:${m.id}`;
    if (m.idempotencyKey !== expectedKey) {
      errors.push(
        `Migration '${m.id}' idempotencyKey must be '${expectedKey}' (got '${m.idempotencyKey}')`
      );
    }
  }

  return errors;
}
