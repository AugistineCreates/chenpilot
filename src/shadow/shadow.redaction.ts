/**
 * shadow.redaction.ts
 *
 * Privacy discipline for the shadow execution path (Issue #686, acceptance:
 * "Inputs are privacy-filtered and retention-bounded").
 *
 * Reuses the backends's canonical PII scrubber (src/AuditLog/auditLog.redaction.ts)
 * so that shadow inputs can never leak credentials or personal data into the
 * divergence store. Shadow execution is intentionally side-effect-free and must
 * never hold credentials capable of mutation — redaction is an additional
 * defence-in-depth layer before anything is compared or persisted.
 */

import { redactPayload, REDACTED_SENTINEL } from "../AuditLog/auditLog.redaction";

/** Keys stripped from stored shadow inputs before they reach any store. */
const STRIP_KEYS = new Set([
  "privateKey",
  "secretKey",
  "signingKey",
  "seed",
  "mnemonic",
  "authorization",
]);

/**
 * Privacy-filter a raw shadow input object.
 * Any value is passed through the shared PII scrubber; a small denylist of
 * keys is removed entirely (not merely redacted) from the stored copy.
 */
export function filterShadowInput(input: Record<string, unknown>): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};

  const redacted = redactPayload(input) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (STRIP_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED_SENTINEL;
      continue;
    }
    out[key] = value;
  }
  return out;
}
