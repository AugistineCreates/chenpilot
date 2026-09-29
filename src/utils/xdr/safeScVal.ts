// src/utils/xdr/safeScVal.ts

import * as StellarSdk from "@stellar/stellar-sdk";
import { XdrSecurityLimits, DEFAULT_XDR_LIMITS } from "./types";
import {
  XdrDepthLimitExceededError,
  XdrCollectionLimitExceededError,
  XdrComputationLimitExceededError,
} from "./errors";

interface TraversalContext {
  depth: number;
  steps: number;
  limits: XdrSecurityLimits;
}

/**
 * Safely converts a Soroban ScVal to a native JavaScript representation
 * with strict depth tracking, computation budget enforcement, and collection bounds.
 */
export function safeScValToNative(
  scVal: StellarSdk.xdr.ScVal,
  limits: XdrSecurityLimits = DEFAULT_XDR_LIMITS
): unknown {
  const ctx: TraversalContext = {
    depth: 0,
    steps: 0,
    limits,
  };

  return traverseScVal(scVal, ctx);
}

function checkBudget(ctx: TraversalContext): void {
  ctx.steps += 1;
  if (ctx.steps > ctx.limits.maxComputationSteps) {
    throw new XdrComputationLimitExceededError(
      ctx.steps,
      ctx.limits.maxComputationSteps,
      ctx.limits.maxDiagnosticLength
    );
  }
}

function traverseScVal(
  scVal: StellarSdk.xdr.ScVal,
  ctx: TraversalContext
): unknown {
  checkBudget(ctx);

  if (ctx.depth > ctx.limits.maxDepth) {
    throw new XdrDepthLimitExceededError(
      ctx.depth,
      ctx.limits.maxDepth,
      ctx.limits.maxDiagnosticLength
    );
  }

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
    const dur = scVal.duration();
    return (
      (BigInt(dur.high) << BigInt(32)) |
      BigInt(dur.low >>> 0)
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
  if (scType === ScValType.scvU256()) {
    const u256 = scVal.u256();
    const hiHi =
      (BigInt(u256.hiHi().high) << BigInt(32)) |
      BigInt(u256.hiHi().low >>> 0);
    const hiLo =
      (BigInt(u256.hiLo().high) << BigInt(32)) |
      BigInt(u256.hiLo().low >>> 0);
    const loHi =
      (BigInt(u256.loHi().high) << BigInt(32)) |
      BigInt(u256.loHi().low >>> 0);
    const loLo =
      (BigInt(u256.loLo().high) << BigInt(32)) |
      BigInt(u256.loLo().low >>> 0);
    const result =
      (hiHi << BigInt(192)) |
      (hiLo << BigInt(128)) |
      (loHi << BigInt(64)) |
      loLo;
    return result.toString();
  }
  if (scType === ScValType.scvI256()) {
    const i256 = scVal.i256();
    const hiHi =
      (BigInt(i256.hiHi().high) << BigInt(32)) |
      BigInt(i256.hiHi().low >>> 0);
    const hiLo =
      (BigInt(i256.hiLo().high) << BigInt(32)) |
      BigInt(i256.hiLo().low >>> 0);
    const loHi =
      (BigInt(i256.loHi().high) << BigInt(32)) |
      BigInt(i256.loHi().low >>> 0);
    const loLo =
      (BigInt(i256.loLo().high) << BigInt(32)) |
      BigInt(i256.loLo().low >>> 0);
    const result =
      (hiHi << BigInt(192)) |
      (hiLo << BigInt(128)) |
      (loHi << BigInt(64)) |
      loLo;
    return result.toString();
  }
  if (scType === ScValType.scvBytes()) {
    return scVal.bytes();
  }
  if (scType === ScValType.scvString()) {
    return scVal.str().toString("utf8");
  }
  if (scType === ScValType.scvSymbol()) {
    return scVal.sym().toString("utf8");
  }
  if (scType === ScValType.scvAddress()) {
    return StellarSdk.Address.fromScAddress(scVal.address()).toString();
  }

  // Handle vectors with collection bound and depth recursion tracking
  if (scType === ScValType.scvVec()) {
    const vec = scVal.vec();
    if (!vec) {
      return [];
    }

    const entries = vec;
    if (entries.length > ctx.limits.maxCollectionEntries) {
      throw new XdrCollectionLimitExceededError(
        entries.length,
        ctx.limits.maxCollectionEntries,
        ctx.limits.maxDiagnosticLength
      );
    }

    ctx.depth += 1;
    try {
      return entries.map((item) => traverseScVal(item, ctx));
    } finally {
      ctx.depth -= 1;
    }
  }

  // Handle maps with collection bound and depth recursion tracking
  if (scType === ScValType.scvMap()) {
    const map = scVal.map();
    if (!map) {
      return {};
    }

    const entries = map;
    if (entries.length > ctx.limits.maxCollectionEntries) {
      throw new XdrCollectionLimitExceededError(
        entries.length,
        ctx.limits.maxCollectionEntries,
        ctx.limits.maxDiagnosticLength
      );
    }

    const result: Record<string, unknown> = {};
    ctx.depth += 1;
    try {
      for (const entry of entries) {
        checkBudget(ctx);
        const key = traverseScVal(entry.key(), ctx);
        const keyStr = typeof key === "string" ? key : JSON.stringify(key);
        result[keyStr] = traverseScVal(entry.val(), ctx);
      }
      return result;
    } finally {
      ctx.depth -= 1;
    }
  }

  // Fallback for contract instance or other extensions
  return StellarSdk.scValToNative(scVal);
}
