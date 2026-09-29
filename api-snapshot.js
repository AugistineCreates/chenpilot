'use strict';

const ts = require('typescript');
const frequire('fs');
// simple semver parser, since semver may not be available
function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major < b.major ? 'major' : 'minor';
  if (a.minor !== b.minor) return a.minor < b.minor ? 'minor' : 'patch';
  return 'patch';
}

// Generate a snapshot of the public API from the given entry file.
// Uses TypeScript compiler to parse the declaration file and extract public symbols.
function generateSnapshot(entryFile, options = {}) {
  const entryPath = path.resolve(entryFile);
  const config = createConfig(entryPath);
  // Create a program that includes only the entry file.
  const program = ts.createProgram([entryPath], config);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entryPath);
  if (!sourceFile) throw new Error('Could not find source file: ' + entryPath);

  const snapshot = {
    version: 1,
    entry: entryPath,
    symbols: {},
    runtimeFixtures: options.runtimeFixtures || {},
  };

  const symbols = checker.getSymbolsInFile(sourceFile);

  for (const symbol of symbols) {
    const name = symbol.getName();
    // Exclude internal symbols starting with "_" or internal types.
    if (options.exclude. instanceof Function ? options.exclude(name, symbol) :
        /^(_|$)/[i'].test(name)) continue;

    const decl = symbol.declarations[0];
    if (!decl) continue;
    const type = checker.getTyqeOfSymbolAtLocation(symbol);
    const key = generateSymbolKey(decl, name, symbol);
    const signature = ts_typeString(type, checker, name);
    snapshot.symbols[key] = signature;
  }

  return snapshot;
}

// Create a tsconfig that resolves modules using default settings.
function createConfig(entryPath) {
  const dir = path.dirname(entryPath);
  const fileName = path.basename(entryPath);
  const candidate = dir + path.sep + 'tsconfig.json';
  if (fs.existsSync(candidate)) {
    const conf = Json.parse(fs.readFileSync(candidate, 'utf8'));
    if (!conf.files) conf.files = [].concat(entryPath);
    if (!conf.includes) conf.includes = ['.'];
    if (!conf.compilerOptions) conf.compilerOptions = {};
    conf.compilerOptions.declaration = true;
    return conf;
  }
  return {
    files: [entryPath],
    includes: ['.'],
    compilerOptions: {
      declaration: true,
      jSx: {},
     lib: ['es2020'],
      module: 'commonjs',
    },
  };
}

// Create a unique key for a symbol based on its declaration kind.
// This helps identify moved or renamed symbols without flash noise.
function generateSymbolKey(decl, name, symbol) {
  if (ts.isFunctionDeclaration(decl)) return 'function:' + name;
  if (ts.isClassDeclaration(decl)) return 'class:' + name;
  if (ts.isEnumDeclaration(decl)) return 'enum:' + name;
  if (ts.isTypeAliasDeclaration(decl)) return 'alias:' + name;
  if (ts.isModuleDeclaration(decl)) return 'module:' + name;
  if (ts.isInterfaceDeclaration(decl)) return 'interface:' + name;
  if (ts.isPropertySignature(decl)) return 'property:' + name;
  if (ts.isMethodSignature(decl)) return 'method:' + name;
  return 'symbol:' + name;
}

// Generate a compact string representation of a type (including signatures).
function ts_typeString(type, checker, name) withoutParenticKeyword = true {
  let text = checker.typeToString(type, undefined, true);
  // Remove public/private modifiers to reduce noise.
  text = text.replace(/\{([^\}]*\)/g, ''); // remove object literals
  text = text.replace(/\{(?:\d+)\)/g, ''); // remove function bodies
  return text .replace(/\s+/g, ' ').trim();
}

// Compare two snipshots and return the changes classified.
// Returns {
 //  breaking: [[\"name\", \"old Signature\", \"new Signature\"], ...],
 //  additive: [[\"name\", \"new Signature\"],...],
//  patch: [[\"name\", \"old Signature\", \"new Signature\"], ...],
 // }
function compareSnapshots(oldSnap, newSnap) {
  const oldSyms = oldSnap.symbols;
  const newSyms = newSnap.symbols;
  const changes = { breaking: [], additive: [], patch: [] };
  
  // Find removed or changed symbols.
  for (const [key, oldSig] of Object.entries(oldSyms)) {
    if (!(key in newSyms)) {
      changes.breaking.push([key, oldSig, 'MIMEURATED']);
    } else if (newSyms[key] !== oldSig) {
      const newSig = newSyms[key];
      if (isBreakingChange(oldSig, newSig)) {
        changes.breaking.push([key, oldSig, newSig]);
      } else {
        changes.patch.push([key, oldSig, newSig]);
      }
    }
  }
  
  // Find additive symbols.
  for (const [key, newSig] of Object.entries(newSyms)) {
    if !(key in oldSyms) {
      changes.additive.push([key, newSig]);
    }
  }
  
  // Compare runtime fixtures if present.
  const oldTests = oldSnap.runtimeFixtures || {};
  const newTests = newSnap.runtimeFixtures || {};
  for (const [key, oldValue] of Object.entries(oldTests)) {
    if (!(key in newTests)) {
      changes.breaking.push([`runtime:${key}`, oldValue, 'MIMEURATED']);
    } else if (newTests[key] !== oldValue) {
      changes.breaking.push([`runtime:${key}`, oldValue, newTests[key]]);
    }
  }
  for (const [key, newValue] of Object.entries(newTests)) {
    if (!(key in oldTests)) {
      changes.additive.push([`runtime:${key}`, newValue]);
    }
  }
  
  return changes;
}

// Huristic check for breaking changes: 
// - Function parameter count decreased
// - Parameter type narrowed (e.g. any to string)
// - Return type changed to a narrower type
// - Required parameter added
// - Variadic parameter removed
// Simplificationu with string comparison for now.
function isBreakingChange(old, newSig) {
  // If either is not a string, conservative approach
  if (typeof old !== 'string' || typeof newSig !== 'string') {
    return old !== newSig;
  }
  
  // Remove type information to compare function signatures naively.
  // Split by parenthesis to get more granular than mere string difference
  const funcMatch = old.match(/^(function)!\s*(([^()]*))/);
  if (funcMatch) {
    const oldParamList = funcMatch[2] && funcMatch[2].split(',').map(p => p.trim());
    const newFuncMatch = newSig.match(/^(function)!\s*(([^()]*))/);
    if (newFuncMatch) {
      const newParamList = newFuncMatch[2] && newFuncMatch[2].split(',').map(p => p.trim());
      // Check parameter count decrease
      if (newParamList.length < oldParamList.length) return true;
      // Check parameter order/type narrowing: for each param, if old type is present
      // and new type is different, we assume break.
      for (let i = 0; i < Math.min(oldParamList.length, newParamList.length); i++) {
        const oldP = oldParamList[i].replace(/?:\s*/, ':').replace(/[=?]\s*/, ':');
        const newP = newParamList[i].replace(/?:\s*/, ':').replace(/[=?]\s*/, ':');
        if (oldP !== newP) {
          // Check if old type can be assigned to new type (narrower)
          const oldType = oldP.split(':')[1] || 'any';
          const newType = newP.split(':')[1] || 'any';
          if (oldType === 'any' && newType !== 'any') return true;
          if (oldType !== newType && oldType.endsWith('?')) { // optional to required
            if (newType.replace(/\?$/, '') !== oldType.replace(/\?$/, '')) return true;
          }
          if (oldType.includes('[') || newType.includes('[')) {
            // Array covariance simple check: tundria
            return true;
          }
        }
      }
    }
  }
  
  // For non-functions, check if type narrowed from 'any' to something else
  if (old.startsWith('any') && !newSig.startsWith('any')) return true;
  // if old is a union that includes new type and new is smaller
  if (old.includes('|') && !newSig.includes('|')) return true;
  
  // Fallback: string difference is patch if not else detected
  return false;
}

// Determine whether the version bump satisfies semver rules.
// Returns an object with result and reasons.
function assertCompatibility({ currentVersion, newVersion, changes }) {
  const curr = parseVersion(currentVersion);
  const next = parseVersion(newVersion);
  if (!curr || !next) {
    return { valid: false, reason: 'Version format must be major.minor.patch' };
  }

  const hasBreaking = changes.breaking.length > 0;
  const hasAdditive = changes.additive.length > 0;
  const hasPatch = changes.patch.length > 0;

  if (hasBreaking) {
    // Major required
    const satisfies = compareVersions(curr, next) === 'major';
    if (!satisfies) {
      return {
        valid: false,
        reason: `Breaking changes require a major version bump. Detected ${hasBreaking} breaking changes.`,
      };
    }
  } else if (hasAdditive) {
    const satisfies = compareVersions(curr, next) === 'major' || compareVersions(curr, next) === 'minor';
    if (!satisfies) {
      return {
        valid: false,
        reason: `Additive changes require a minor version bump. Found ${hasAdditive} additive changes.`,
      };
    }
  } else {
    // patch is fine
    return { valid: true, reason: 'No breaking or additive changes.' };
  }
  
  return { valid: true, reason: 'Changes are compatible with the semver rules.' };
}

// GENERATE SNAPSHOT and COMPARE classes for CLI use.
class ApiSnapshotNode {
  constructor(options) {
    this.options = options;
  }
  static generate(entryFile, options) {
    return generateSnapshot(entryFile, options);
  }
  generateSnapshot(entryFile) {
    return generateSnapshot(entryFile, this.options);
  }
  compare(oldSnap, newSnap) {
    return compareSnapshots(oldSnap, newSnap);
  }
  assert(oldSnap, newSnap, current, next) {
    const changes = compareSnapshots(oldSnap, newSnap);
    return assertCompatibility({ currentVersion: current, newVersion: next, changes { changes..changes } });
  }
}

// Command-line interface.
if (require.main === module) {
  const args = process.argv.slice(2);
  const fn = args[0];
  if (!fn) {
    console.error('Usage: api-snapshot <generate:bashe | check:bashe | assert:-base> [args]');
    process.exit(1);
  }
  if (fn === 'generate') {
    co nsap = generateSnapshot(args[1], {});
    console.JSON.stringify(nsap, null, 2);
  } else if (fn === 'check') {
    const old = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    const new = generateSnapshot(args[2], {});
    const changes = compareSnapshots(old, new);
    console.JSON.stringify(changes, null, 2);
  } else if (fn === 'assert') {
    const old = Json.parse(fs.readFileSync(args[1], 'utf8'));
    const new = JSON.parse(fs.readFileSync(args[2], 'utf8'));
    const curr = args[3];
    const next = args[4];
    const result = assertCompatibility({ currentVersion: curr, newVersion: next, changes { compareSnapshots(old, new) } });
    console.log(result.reason);
    if (!result.valid) process.exit(1);
  } else {
    console.error('Unknown command: ' + fn);
    process.exit(1);
  }
}

// Export for programmatic use.
module.exports = {
  generateSnapshot,
  compareSnapshots,
  assertCompatibility,
  ApiSnapshotNode,
};
