/**
 * extract-storage-schema.ts
 *
 * Parses every Rust contract's lib.rs in contracts/<name>/src/lib.rs and emits a
 * canonical JSON schema to contracts/schemas/<name>.schema.json.
 *
 * The schema captures:
 *  - contract name and source file path
 *  - every DataKey variant with storage tier (Instance | Persistent | Temporary)
 *  - the Rust value type stored against each key
 *  - TTL constants visible in the same file
 *  - all #[contracttype] struct/enum shapes (field names + Rust types)
 *
 * Usage:
 *   npx ts-node scripts/extract-storage-schema.ts [--contracts-dir <path>] [--out-dir <path>] [--contract <name>]
 *
 * Conservative rule: when storage tier or value type cannot be determined
 * with certainty they are recorded as "unknown" so the downstream
 * compatibility checker can flag those entries for manual review.
 *
 * ES2016-compatible: no dotAll (s) flag, no lookbehind assertions.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Public types (also consumed by check-storage-compat.ts and simulate-upgrade.ts)
// ---------------------------------------------------------------------------

export type StorageTier = "Instance" | "Persistent" | "Temporary" | "unknown";

export interface SchemaField {
  name: string;
  rust_type: string;
}

export interface SchemaVariant {
  name: string;
  payload?: string;
}

export interface ContractTypeShape {
  kind: "struct" | "enum";
  name: string;
  fields: SchemaField[];
  variants?: SchemaVariant[];
}

export interface StorageEntry {
  key_variant: string;
  key_payload?: string;
  value_type: string;
  storage_tier: StorageTier;
  ttl?: string;
}

export interface ContractSchema {
  contract: string;
  source: string;
  schema_version: string;
  extracted_at: string;
  ttl_constants: Record<string, number>;
  data_key_variants: StorageEntry[];
  contract_types: ContractTypeShape[];
}

// ---------------------------------------------------------------------------
// Regex patterns (no dotAll flag — es2016 compatible)
// ---------------------------------------------------------------------------

// Each DataKey variant line: optional leading whitespace, name, optional (payload), comma
const VARIANT_LINE_RE = /^\s*([\w]+)(?:\(([^)]+)\))?\s*,?\s*(?:\/\/.*)?$/;

// Storage write sites
const INSTANCE_WRITE_RE =
  /env\.storage\(\)\.instance\(\)\.(set|set_with_ttl)\s*\(\s*&DataKey::([\w]+)/g;
const PERSISTENT_WRITE_RE =
  /env\.storage\(\)\.persistent\(\)\.(set|set_with_ttl)\s*\(\s*&DataKey::([\w]+)/g;
const TEMPORARY_WRITE_RE =
  /env\.storage\(\)\.temporary\(\)\.(set|set_with_ttl)\s*\(\s*&DataKey::([\w]+)/g;

// Typed turbofish get calls
const INSTANCE_GET_TYPED_RE =
  /env\.storage\(\)\.instance\(\)\.get::<DataKey,\s*([\w<>, :]+)>\s*\(\s*&DataKey::([\w]+)/g;
const PERSISTENT_GET_TYPED_RE =
  /env\.storage\(\)\.persistent\(\)\.get::<DataKey,\s*([\w<>, :]+)>\s*\(\s*&DataKey::([\w]+)/g;

// let binding type annotation before storage call
const TYPED_LET_RE =
  /let\s+\w+\s*:\s*([\w<>, :]+)\s*=\s*env\.storage\(\)\.(instance|persistent|temporary)\(\)\.(get|get_or_default)\s*\(\s*&DataKey::([\w]+)/g;

// TTL const declarations
const TTL_CONST_RE = /const\s+([\w]+)\s*:\s*u32\s*=\s*([\d_]+)\s*;/g;

// set_with_ttl / extend_ttl third argument
const SET_WITH_TTL_RE =
  /env\.storage\(\)\.(instance|persistent|temporary)\(\)\.set_with_ttl\s*\(\s*&DataKey::([\w]+)\s*,[^,]+,\s*([\w]+)\s*\)/g;
const EXTEND_TTL_RE =
  /env\.storage\(\)\.(instance|persistent|temporary)\(\)\.extend_ttl\s*\(\s*&DataKey::([\w]+)\s*,\s*[\w]+\s*,\s*([\w]+)\s*\)/g;

// ---------------------------------------------------------------------------
// Multi-line block extraction helper (no dotAll)
// ---------------------------------------------------------------------------

/**
 * Extracts blocks of the form `keyword Name { ... }` from source text.
 * Returns an array of [name, body] pairs where body is the content inside {}.
 * Handles one level of nested braces.
 */
function extractBracedBlocks(
  src: string,
  keyword: string
): Array<{ name: string; body: string; annotated: boolean }> {
  const results: Array<{ name: string; body: string; annotated: boolean }> = [];
  // Find all positions matching `pub (struct|enum) Name {`
  const headerRe = new RegExp(`(#\\[contracttype\\][^\\n]*\\n(?:#\\[[^\\]]*\\][^\\n]*\\n)*)?pub\\s+${keyword}\\s+(\\w+)\\s*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(src)) !== null) {
    const name = m[2];
    const annotated = m[1] !== undefined && m[1].includes("#[contracttype]");
    let depth = 1;
    let i = m.index + m[0].length;
    let body = "";
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      body += src[i];
      i++;
    }
    results.push({ name, body, annotated });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function parseDataKeyVariants(src: string): Array<{ name: string; payload?: string }> {
  // Find the DataKey enum body
  const blocks = extractBracedBlocks(src, "enum").filter((b) => b.name === "DataKey");
  if (blocks.length === 0) return [];
  const body = blocks[0].body;
  const variants: Array<{ name: string; payload?: string }> = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const m = VARIANT_LINE_RE.exec(line);
    if (m && m[1]) {
      variants.push({ name: m[1], payload: m[2]?.trim() });
    }
  }
  return variants;
}

function extractTtlConstants(src: string): Record<string, number> {
  const result: Record<string, number> = {};
  TTL_CONST_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TTL_CONST_RE.exec(src)) !== null) {
    result[m[1]] = parseInt(m[2].replace(/_/g, ""), 10);
  }
  return result;
}

function buildTierMap(src: string): Map<string, StorageTier> {
  const map = new Map<string, StorageTier>();

  function scan(re: RegExp, tier: StorageTier) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const v = m[2];
      if (!map.has(v)) map.set(v, tier);
    }
  }

  scan(INSTANCE_WRITE_RE, "Instance");
  scan(PERSISTENT_WRITE_RE, "Persistent");
  scan(TEMPORARY_WRITE_RE, "Temporary");

  TYPED_LET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TYPED_LET_RE.exec(src)) !== null) {
    const raw = m[2];
    const v = m[4];
    if (!map.has(v)) {
      const tier: StorageTier =
        raw === "instance" ? "Instance" : raw === "persistent" ? "Persistent" : "Temporary";
      map.set(v, tier);
    }
  }

  return map;
}

function buildValueTypeMap(src: string): Map<string, string> {
  const map = new Map<string, string>();

  function scan(re: RegExp) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const vt = m[1].trim();
      const v = m[2];
      if (!map.has(v)) map.set(v, vt);
    }
  }

  scan(INSTANCE_GET_TYPED_RE);
  scan(PERSISTENT_GET_TYPED_RE);

  TYPED_LET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TYPED_LET_RE.exec(src)) !== null) {
    const v = m[4];
    if (!map.has(v)) map.set(v, m[1].trim());
  }

  return map;
}

function buildTtlMap(src: string): Map<string, string> {
  const map = new Map<string, string>();

  function scan(re: RegExp) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const v = m[2];
      if (!map.has(v)) map.set(v, m[3]);
    }
  }

  scan(SET_WITH_TTL_RE);
  scan(EXTEND_TTL_RE);
  return map;
}

function parseContractTypes(src: string): ContractTypeShape[] {
  const types: ContractTypeShape[] = [];
  const seen = new Set<string>();

  // Structs with #[contracttype]
  for (const { name, body, annotated } of extractBracedBlocks(src, "struct")) {
    if (!annotated || seen.has(name)) continue;
    seen.add(name);
    const fields: SchemaField[] = [];
    const fieldRe = /pub\s+(\w+)\s*:\s*([^,\n\}]+)/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(body)) !== null) {
      fields.push({ name: fm[1], rust_type: fm[2].trim().replace(/,\s*$/, "") });
    }
    types.push({ kind: "struct", name, fields });
  }

  // Enums with #[contracttype] (skip DataKey — handled separately)
  for (const { name, body, annotated } of extractBracedBlocks(src, "enum")) {
    if (!annotated || seen.has(name) || name === "DataKey") continue;
    seen.add(name);
    const variants: SchemaVariant[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      const vm = VARIANT_LINE_RE.exec(line);
      if (vm && vm[1]) {
        variants.push({ name: vm[1], payload: vm[2]?.trim() });
      }
    }
    types.push({ kind: "enum", name, fields: [], variants });
  }

  return types;
}

// ---------------------------------------------------------------------------
// Public extractor
// ---------------------------------------------------------------------------

export function extractContractSchema(contractName: string, libPath: string): ContractSchema {
  const src = fs.readFileSync(libPath, "utf8");

  const ttlConstants = extractTtlConstants(src);
  const keyVariants = parseDataKeyVariants(src);
  const tierMap = buildTierMap(src);
  const valueTypeMap = buildValueTypeMap(src);
  const ttlMap = buildTtlMap(src);
  const contractTypes = parseContractTypes(src);

  const dataKeyVariants: StorageEntry[] = keyVariants.map((kv) => {
    const entry: StorageEntry = {
      key_variant: kv.name,
      value_type: valueTypeMap.get(kv.name) ?? "unknown",
      storage_tier: tierMap.get(kv.name) ?? "unknown",
    };
    if (kv.payload) entry.key_payload = kv.payload;
    const ttlRef = ttlMap.get(kv.name);
    if (ttlRef) entry.ttl = ttlRef;
    return entry;
  });

  return {
    contract: contractName,
    source: path.relative(process.cwd(), libPath),
    schema_version: "1.0.0",
    extracted_at: new Date().toISOString(),
    ttl_constants: ttlConstants,
    data_key_variants: dataKeyVariants,
    contract_types: contractTypes,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let contractsDir = path.join(process.cwd(), "contracts");
  let outDir = path.join(process.cwd(), "contracts", "schemas");
  let singleContract: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--contracts-dir") contractsDir = args[++i];
    else if (args[i] === "--out-dir") outDir = args[++i];
    else if (args[i] === "--contract") singleContract = args[++i];
  }

  fs.mkdirSync(outDir, { recursive: true });

  const dirs = fs
    .readdirSync(contractsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => {
      if (singleContract) return name === singleContract;
      return fs.existsSync(path.join(contractsDir, name, "src", "lib.rs"));
    });

  let ok = 0;
  const errors: string[] = [];

  for (const name of dirs) {
    const libPath = path.join(contractsDir, name, "src", "lib.rs");
    try {
      const schema = extractContractSchema(name, libPath);
      const out = path.join(outDir, `${name}.schema.json`);
      fs.writeFileSync(out, JSON.stringify(schema, null, 2) + "\n");
      console.log(
        `✓ ${name} → ${path.relative(process.cwd(), out)}` +
          ` (${schema.data_key_variants.length} keys, ${schema.contract_types.length} types)`
      );
      ok++;
    } catch (err) {
      const msg = `✗ ${name}: ${(err as Error).message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(`\nExtracted ${ok} schema(s) to ${path.relative(process.cwd(), outDir)}`);
  if (errors.length) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
