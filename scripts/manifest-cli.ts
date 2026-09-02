/**
 * manifest-cli.ts
 *
 * Operational CLI for signed deployment manifests (Issue #676).
 *
 * Usage (from repo root; the manifest signing key is supplied via
 * MANIFEST_SIGNING_KEY in the environment, or generated with `keygen`):
 *
 *   npx ts-node scripts/manifest-cli.ts keygen --file /tmp/manifest_signing_key
 *   MANIFEST_SIGNING_KEY="$(cat /tmp/manifest_signing_key)" \
 *     npx ts-node scripts/manifest-cli.ts publish \
 *       --network testnet --contract core_vault \
 *       --contract-id C... --wasm-hash <64 hex> --interface-version 1.0.0
 *   MANIFEST_SIGNING_KEY="$(cat /tmp/manifest_signing_key)" \
 *     npx ts-node scripts/manifest-cli.ts rotate \
 *       --network testnet --contract core_vault \
 *       --contract-id C... --wasm-hash <64 hex> --interface-version 1.0.1 \
 *       --notes "upgrade core vault"
 *   npx ts-node scripts/manifest-cli.ts show --network testnet --contract core_vault
 *
 * Use `MANIFEST_ENFORCEMENT=off` to soften the runtime gate for degraded/offline
 * operation; do NOT run production traffic in that mode.
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { manifestService } from "../src/ContractIdentity/manifestService";
import { manifestStore } from "../src/ContractIdentity/manifestStore";
import { ManifestNetwork } from "../src/ContractIdentity/deploymentManifest.types";
import { ManifestError } from "../src/ContractIdentity/errors";

import {
  createSignedManifest,
  deriveUpgradeAuthority,
} from "../src/ContractIdentity/deploymentManifest";

function printHelp(): void {
  console.log(
    [
      "manifest-cli — signed deployment manifest operations",
      "Commands:",
      "  keygen   --file <pemPath>           Generate a fresh Ed25519 signing key.",
      "  pubkey                                Print the upgrade authority public key (hex) for the configured key.",
      "  publish  <options>                   Publish a new signed manifest.",
      "  rotate   <options>                   Rotate an existing manifest (signed + auditable).",
      "  show     --network <n> --contract <c> Read a manifest.",
      "  list                                  List all manifests.",
      "Options for publish/rotate:",
      "  --network <testnet|mainnet>   Required.",
      "  --contract <name>             Required. Logical contract key (e.g. core_vault).",
      "  --contract-id <C...>          Required. On-chain Contract ID.",
      "  --wasm-hash <64hex>           Required. SHA-256 of the deployed WASM.",
      "  --interface-version <semver>  Required. Contract interface version.",
      "  --notes <text>                Optional. Rotation justification.",
      "",
    ].join("\n")
  );
}

interface CliOptions {
  network?: ManifestNetwork;
  contract?: string;
  contractId?: string;
  wasmHash?: string;
  interfaceVersion?: string;
  notes?: string;
  file?: string;
}

function parseArgs(argv: string[]): { command: string; opts: CliOptions } {
  const command = argv[0];
  const opts: CliOptions = {};
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--network":
        if (value !== "testnet" && value !== "mainnet") {
          throw new ManifestError(`Invalid --network "${value}"`);
        }
        opts.network = value;
        break;
      case "--contract":
        opts.contract = value;
        break;
      case "--contract-id":
        opts.contractId = value;
        break;
      case "--wasm-hash":
        opts.wasmHash = value;
        break;
      case "--interface-version":
        opts.interfaceVersion = value;
        break;
      case "--notes":
        opts.notes = value;
        break;
      case "--file":
        opts.file = value;
        break;
      default:
        throw new ManifestError(`Unknown flag "${flag}"`);
    }
  }
  if (!command) throw new ManifestError("Missing command; use --help");
  return { command, opts };
}

function requireOpt<T>(
  opts: CliOptions,
  key: keyof CliOptions,
  label: string
): T {
  const value = opts[key] as T | undefined;
  if (value === undefined || value === "") {
    throw new ManifestError(`Missing ${label}`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  const { command, opts } = parseArgs(args);
  const out = (...m: unknown[]) => process.stdout.write(`${m.join(" ")}\n`);

  switch (command) {
    case "keygen": {
      const file = requireOpt<string>(opts, "file", "--file <pemPath>");
      if (fs.existsSync(file) && fs.readFileSync(file).length > 0) {
        throw new ManifestError(
          `Refusing to overwrite existing key file ${file}`
        );
      }
      const dir = path.dirname(path.resolve(file));
      fs.mkdirSync(dir, { recursive: true });
      execFileSync("ssh-keygen", [
        "-t",
        "ed25519",
        "-m",
        "PEM",
        "-f",
        file,
        "-N",
        "",
      ]);
      const pem = fs.readFileSync(file, "utf8");
      out("Generated Ed25519 signing key at", file);
      out(
        "Set it in the environment as MANIFEST_SIGNING_KEY:\n" +
          `  export MANIFEST_SIGNING_KEY='${pem.trim()}'\n`
      );
      break;
    }
    case "pubkey": {
      out(deriveUpgradeAuthority());
      break;
    }
    case "publish": {
      const payload = {
        contractName: requireOpt<string>(opts, "contract", "--contract <name>"),
        network: requireOpt<ManifestNetwork>(opts, "network", "--network"),
        contractId: requireOpt<string>(opts, "contractId", "--contract-id"),
        wasmHash: requireOpt<string>(opts, "wasmHash", "--wasm-hash"),
        interfaceVersion: requireOpt<string>(
          opts,
          "interfaceVersion",
          "--interface-version"
        ),
        dependencies: [],
        upgradeAuthority: deriveUpgradeAuthority(),
        signedAt: new Date().toISOString(),
        generation: 0,
      };
      const manifest = createSignedManifest(payload);
      await manifestStore.save(manifest);
      out("Published:", JSON.stringify(manifest, null, 2));
      break;
    }
    case "rotate": {
      const network = requireOpt<ManifestNetwork>(opts, "network", "--network");
      const contract = requireOpt<string>(
        opts,
        "contract",
        "--contract <name>"
      );
      const rotated = await manifestService.rotate(
        network,
        contract,
        {
          contractId: requireOpt<string>(opts, "contractId", "--contract-id"),
          wasmHash: requireOpt<string>(opts, "wasmHash", "--wasm-hash"),
          interfaceVersion: requireOpt<string>(
            opts,
            "interfaceVersion",
            "--interface-version"
          ),
          notes: opts.notes,
        },
        { serviceId: "manifest-cli" }
      );
      out("Rotated:", JSON.stringify(rotated, null, 2));
      break;
    }
    case "show": {
      const network = requireOpt<ManifestNetwork>(opts, "network", "--network");
      const contract = requireOpt<string>(
        opts,
        "contract",
        "--contract <name>"
      );
      const manifest = await manifestStore.load(network, contract);
      if (!manifest)
        throw new ManifestError(`No manifest for ${network}/${contract}`);
      out(JSON.stringify(manifest, null, 2));
      break;
    }
    case "list": {
      const manifests = await manifestStore.list();
      out(JSON.stringify(manifests, null, 2));
      break;
    }
    default:
      throw new ManifestError(`Unknown command "${command}"`);
  }
}

main().catch((err) => {
  console.error(
    "manifest-cli error:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
