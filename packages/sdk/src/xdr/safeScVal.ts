// packages/sdk/src/xdr/safeScVal.ts

import * as StellarSdk from "@stellar/stellar-sdk";
import {
  XdrSecurityLimits,
  DEFAULT_XDR_LIMITS,
  SafeXdrDecodeOptions,
} from "./types";
import {
  XdrDepthLimitExceededError,
  XdrCollectionLimitExceededError,
  XdrComputationLimitExceededError,
  XdrMalformedError,
} from "./errors";

interface TraversalContext {
  depth: number;
  steps: number;
  limits: XdrSecurityLimits;
}

/**
 * Safely converts an ScVal into native JavaScript types with strict
 * depth, computation, and collection size bounds.
 */
export function safeScValToNative(
  val: unknown,
  options: SafeXdrDecodeOptions = {}
): unknown {
  if (val === null || val === undefined) return null;

  const limits: XdrSecurityLimits = {
    ...DEFAULT_XDR_LIMITS,
    ...options.limits,
  };

  const context: TraversalContext = {
    depth: 0,
    steps: 0,
    limits,
  };

  return traverseScVal(val, context);
}

function traverseScVal(val: unknown, ctx: TraversalContext): unknown {
  ctx.steps++;
  if (ctx.steps > ctx.limits.maxComputationSteps) {
    throw new XdrComputationLimitExceededError(
      ctx.steps,
      ctx.limits.maxComputationSteps,
      ctx.limits.maxDiagnosticLength
    );
  }

  if (ctx.depth > ctx.limits.maxDepth) {
    throw new XdrDepthLimitExceededError(
      ctx.depth,
      ctx.limits.maxDepth,
      ctx.limits.maxDiagnosticLength
    );
  }

  if (val === null || val === undefined) return null;

  // Check if val is a StellarSdk xdr.ScVal
  if (typeof (val as Record<string, unknown>).switch === "function") {
    const scVal = val as StellarSdk.xdr.ScVal;
    return convertXdrScVal(scVal, ctx);
  }

  // Fallback for native primitives or plain objects already partially unpacked
  if (typeof val === "object") {
    if (Array.isArray(val)) {
      if (val.length > ctx.limits.maxCollectionEntries) {
        throw new XdrCollectionLimitExceededError(
          val.length,
          ctx.limits.maxCollectionEntries,
          ctx.limits.maxDiagnosticLength
        );
      }
      ctx.depth++;
      try {
        return val.map((item) => traverseScVal(item, ctx));
      } finally {
        ctx.depth--;
      }
    }

    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length > ctx.limits.maxCollectionEntries) {
      throw new XdrCollectionLimitExceededError(
        keys.length,
        ctx.limits.maxCollectionEntries,
        ctx.limits.maxDiagnosticLength
      );
    }
    ctx.depth++;
    try {
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        result[k] = traverseScVal(obj[k], ctx);
      }
      return result;
    } finally {
      ctx.depth--;
    }
  }

  return val;
}

function convertXdrScVal(
  scVal: StellarSdk.xdr.ScVal,
  ctx: TraversalContext
): unknown {
  const scType = scVal.switch();
  const ScValType = StellarSdk.xdr.ScValType;

  // Handle primitives
  if (scType === ScValType.scvBool()) {
    return scVal.b();
  }
  if (scType === ScValType.scvVoid()) {
    return null;
  }
  if (scType === ScValType.scvError()) {
    return StellarSdk.scValToNative(scVal);
  }
  if (scType === ScValType.scvU32()) {
    return scVal.u32();
  }
  if (scType === ScValType.scvI32()) {
    return scVal.i32();
  }
  if (scType === ScValType.scvU64()) {
    const u64 = scVal.u64();
    return (
      (BigInt(u64.high) << BigInt(32)) |
      BigInt(u64.low >>> 0)
    ).toString();
  }
  if (scType === ScValType.scvI64()) {
    const i64 = scVal.i64();
    return (
      (BigInt(i64.high) << BigInt(32)) |
      BigInt(i64.low >>> 0)
    ).toString();
  }
  if (scType === ScValType.scvTimepoint()) {
    const tp = scVal.timepoint();
    return (
      (BigInt(tp.high) << BigInt(32)) |
      BigInt(tp.low >>> 0)
    ).toString();
  }
  if (scType === ScValType.scvDuration()) {
    const d = scVal.duration();
    return (
      (BigInt(d.high) << BigInt(32)) |
      BigInt(d.low >>> 0)
    ).toString();
  }
  if (scType === ScValType.scvU128()) {
    const u128 = scVal.u128();
    const hi =
      (BigInt(u128.hi().high) << BigInt(32)) |
      BigInt(u128.hi().low >>> 0);
    const lo =
      (BigInt(u128.lo().high) << BigInt(32)) |
      BigInt(u128.lo().low >>> 0);
    return ((hi << BigInt(64)) | lo).toString();
  }
  if (scType === ScValType.scvI128()) {
    const i128 = scVal.i128();
    const hi =
      (BigInt(i128.hi().high) << BigInt(32)) |
      BigInt(i128.hi().low >>> 0);
    const lo =
      (BigInt(i128.lo().high) << BigInt(32)) |
      BigInt(i128.lo().low >>> 0);
    return ((hi << BigInt(64)) | lo).toString();
  }
  if (scType === ScValType.scvBytes()) {
    const buf = scVal.bytes();
    if (buf.length > ctx.limits.maxByteLength) {
      throw new XdrCollectionLimitExceededError(
        buf.length,
        ctx.limits.maxByteLength,
        ctx.limits.maxDiagnosticLength
      );
    }
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }
  if (scType === ScValType.scvString()) {
    return scVal.str().toString();
  }
  if (scType === ScValType.scvSymbol()) {
    return scVal.sym().toString();
  }

  // Handle Vectors (arrays)
  if (scType === ScValType.scvVec()) {
    const vec = scVal.vec();
    if (!vec) return [];

    if (vec.length > ctx.limits.maxCollectionEntries) {
      throw new XdrCollectionLimitExceededError(
        vec.length,
        ctx.limits.maxCollectionEntries,
        ctx.limits.maxDiagnosticLength
      );
    }

    ctx.depth++;
    try {
      return vec.map((item) => traverseScVal(item, ctx));
    } finally {
      ctx.depth--;
    }
  }

  // Handle Maps
  if (scType === ScValType.scvMap()) {
    const mapEntries = scVal.map();
    if (!mapEntries) return {};

    if (mapEntries.length > ctx.limits.maxCollectionEntries) {
      throw new XdrCollectionLimitExceededError(
        mapEntries.length,
        ctx.limits.maxCollectionEntries,
        ctx.limits.maxDiagnosticLength
      );
    }

    ctx.depth++;
    try {
      const result: Record<string, unknown> = {};
      for (const entry of mapEntries) {
        const key = String(traverseScVal(entry.key(), ctx));
        const val = traverseScVal(entry.val(), ctx);
        result[key] = val;
      }
      return result;
    } finally {
      ctx.depth--;
    }
  }

  // Handle Address
  if (scType === ScValType.scvAddress()) {
    const addr = scVal.address();
    return StellarSdk.Address.fromScAddress(addr).toString();
  }

  // Fallback to StellarSdk.scValToNative with error wrapping
  try {
    return StellarSdk.scValToNative(scVal);
  } catch (err) {
    throw new XdrMalformedError(
      `Unsupported ScVal type '${scType.name}': ${err instanceof Error ? err.message : "decode error"}`,
      ctx.limits.maxDiagnosticLength
    );
  }
}
