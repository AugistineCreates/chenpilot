/**
 * validate-release-manifest.ts
 *
 * Gates the release manifest against the compatibility report.
 * A release manifest lists which contracts are being upgraded in this release.
 * Any contract with a BREAKING storage change (no declared migration) blocks the release.
 *
 * Exit codes:
 *   0  – manifest is valid and all listed contracts pass storage safety checks
 *   1  – one or more contracts in the manifest have blocking issues
 *   2  – usage / IO error
 *
 * Usage:
 *   npx ts-node scripts/validate-release-manifest.ts \
 *     --manifest contracts/release-manifest.json \
 *     --compat-report contracts/compat-report.json \
 *     --sim-report contracts/simulation-report.json \
 *     --migrations contracts/migrations/registry.json
 */

import * as fs from "fs";
import * as path from "path";
import type { CompatReport, ContractCompatResult, KeyChange } from "./check-storage-compat";
import type { SimulationReport, ContractSimResult } from "./simulate-upgrade";
import { loadRegistry, validateRegistry } from "./migration-registry-loader";

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  contract: string;
  from_version: string;
  to_version: string;
  wasm_hash?: string;
  notes?: string;
}

export interface ReleaseManifest {
  release_tag: string;
  target_network: "testnet" | "mainnet" | "futurenet";
  authored_at: string;
  contracts: ManifestEntry[];
}

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

export type ContractGateStatus = "approved" | "blocked" | "warn_only" | "skipped";

export interface ContractGateResult {
  contract: string;
  from_version: string;
  to_version: string;
  status: ContractGateStatus;
  blocking_issues: string[];
  warnings: string[];
}

export interface ManifestValidationResult {
  manifest_release_tag: string;
  generated_at: string;
  overall_status: "approved" | "blocked";
  contracts: ContractGateResult[];
  summary: {
    total: number;
    approved: number;
    blocked: number;
    warn_only: number;
    skipped: number;
  };
}

// ---------------------------------------------------------------------------
// Validation logic
// ---------------------------------------------------------------------------

export function validateManifest(
  manifest: ReleaseManifest,
  compatReport: CompatReport | null,
  simReport: SimulationReport | null,
  migrationsPath: string
): ManifestValidationResult {
  const registry = loadRegistry(migrationsPath);
  const registryErrors = validateRegistry(registry);

  const contractResults: ContractGateResult[] = [];

  for (const entry of manifest.contracts) {
    const blockingIssues: string[] = [];
    const warnings: string[] = [];

    // 1. Migration registry self-consistency
    if (registryErrors.length > 0) {
      blockingIssues.push(
        `Migration registry has ${registryErrors.length} validation error(s): ${registryErrors.slice(0, 3).join("; ")}`
      );
    }

    // 2. Compatibility report checks
    if (compatReport) {
      const compatResult: ContractCompatResult | undefined = compatReport.contracts.find(
        (r) => r.contract === entry.contract
      );

      if (!compatResult) {
        warnings.push(
          `No compatibility report entry found for '${entry.contract}' — run extract-storage-schema.ts and check-storage-compat.ts first`
        );
      } else {
        for (const change of compatResult.changes) {
          if (change.classification === "breaking") {
            blockingIssues.push(
              `BREAKING [${change.key_variant}]: ${change.detail}`
            );
          } else if (change.classification === "requires_migration") {
            // Migration declared — just a warning, not a block
            warnings.push(
              `MIGRATION REQUIRED [${change.key_variant}]: ${change.detail} (migration: ${change.migration_id})`
            );
          }
        }
      }
    } else {
      warnings.push(
        "No compatibility report provided — storage compatibility was not checked. Run check-storage-compat.ts."
      );
    }

    // 3. Simulation report checks
    if (simReport) {
      const simResults = simReport.contracts.filter((r) => r.contract === entry.contract);

      if (simResults.length === 0) {
        warnings.push(
          `No simulation result for '${entry.contract}' — add state snapshots to contracts/snapshots/${entry.contract}/`
        );
      } else {
        for (const sim of simResults) {
          if (!sim.passed) {
            const failures = sim.entries.filter(
              (e) =>
                e.result === "orphaned_without_migration" ||
                (e.result === "type_mismatch" && !e.migration_id) ||
                (e.result === "tier_mismatch" && !e.migration_id)
            );
            for (const f of failures) {
              blockingIssues.push(
                `SIMULATION FAIL [${f.key_variant}]: ${f.detail}`
              );
            }
          }
        }
      }
    } else {
      warnings.push(
        "No simulation report provided — upgrade simulation was not run. Run simulate-upgrade.ts."
      );
    }

    // 4. Determine gate status
    let status: ContractGateStatus;
    if (blockingIssues.length > 0) {
      status = "blocked";
    } else if (warnings.length > 0) {
      status = "warn_only";
    } else {
      status = "approved";
    }

    contractResults.push({
      contract: entry.contract,
      from_version: entry.from_version,
      to_version: entry.to_version,
      status,
      blocking_issues: blockingIssues,
      warnings,
    });
  }

  const summary = {
    total: contractResults.length,
    approved: contractResults.filter((r) => r.status === "approved").length,
    blocked: contractResults.filter((r) => r.status === "blocked").length,
    warn_only: contractResults.filter((r) => r.status === "warn_only").length,
    skipped: contractResults.filter((r) => r.status === "skipped").length,
  };

  return {
    manifest_release_tag: manifest.release_tag,
    generated_at: new Date().toISOString(),
    overall_status: summary.blocked > 0 ? "blocked" : "approved",
    contracts: contractResults,
    summary,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function main() {
  const args = process.argv.slice(2);
  let manifestPath = path.join(process.cwd(), "contracts", "release-manifest.json");
  let compatReportPath = path.join(process.cwd(), "contracts", "compat-report.json");
  let simReportPath = path.join(process.cwd(), "contracts", "simulation-report.json");
  let migrationsPath = path.join(process.cwd(), "contracts", "migrations", "registry.json");
  let outPath = path.join(process.cwd(), "contracts", "manifest-validation.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") manifestPath = args[++i];
    else if (args[i] === "--compat-report") compatReportPath = args[++i];
    else if (args[i] === "--sim-report") simReportPath = args[++i];
    else if (args[i] === "--migrations") migrationsPath = args[++i];
    else if (args[i] === "--out") outPath = args[++i];
  }

  if (!fs.existsSync(manifestPath)) {
    console.error(`Release manifest not found: ${manifestPath}`);
    console.error(`Create contracts/release-manifest.json listing contracts to be upgraded.`);
    process.exit(2);
  }

  const manifest = loadJson<ReleaseManifest>(manifestPath);
  const compatReport = fs.existsSync(compatReportPath)
    ? loadJson<CompatReport>(compatReportPath)
    : null;
  const simReport = fs.existsSync(simReportPath)
    ? loadJson<SimulationReport>(simReportPath)
    : null;

  const result = validateManifest(manifest, compatReport, simReport, migrationsPath);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");

  // Human-readable output
  console.log(`\nRelease Manifest Validation — ${result.manifest_release_tag}`);
  console.log(`${"═".repeat(60)}`);
  for (const r of result.contracts) {
    const icon =
      r.status === "approved" ? "✅" :
      r.status === "blocked" ? "🚫" :
      r.status === "warn_only" ? "⚠️ " : "⏭ ";
    console.log(`\n${icon}  ${r.contract} (${r.from_version} → ${r.to_version})`);
    for (const issue of r.blocking_issues) {
      console.log(`     🔴 ${issue}`);
    }
    for (const warn of r.warnings) {
      console.log(`     🟡 ${warn}`);
    }
    if (r.status === "approved") {
      console.log(`     ✓ All storage safety checks passed`);
    }
  }
  console.log(`\n${"═".repeat(60)}`);
  const statusIcon = result.overall_status === "approved" ? "✅ APPROVED" : "🚫 BLOCKED";
  console.log(`Release status: ${statusIcon}`);
  console.log(
    `Contracts: ${result.summary.approved} approved / ${result.summary.blocked} blocked / ${result.summary.warn_only} with warnings`
  );
  console.log(`Report written to ${path.relative(process.cwd(), outPath)}\n`);

  process.exit(result.overall_status === "blocked" ? 1 : 0);
}

if (require.main === module) {
  main();
}
