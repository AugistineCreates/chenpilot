import crypto from "crypto";

/**
 * Generate a stable, unique event identity.
 *
 * The returned UUID is based on a random UUID v4.  Callers who want a
 * *deterministic* identity (e.g. to guarantee idempotency across retries of
 * the same logical operation) should supply their own `eventId` instead of
 * relying on this function.
 */
export function generateStableEventId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a deterministic event ID from the operation context.
 *
 * Use this when the same logical operation should always produce the same
 * eventId, guaranteeing at-most-once semantics even under retries.
 *
 * @param eventType  Dot-separated event type, e.g. "transaction.created"
 * @param aggregateId  The aggregate ID
 * @param timestamp  Optional timestamp bucket (e.g. minute-level) to scope
 *                   deduplication to a time window
 */
export function deterministicEventId(
  eventType: string,
  aggregateId: string,
  timestamp?: Date
): string {
  const bucket = timestamp
    ? Math.floor(timestamp.getTime() / 60_000).toString()
    : "epoch";
  const raw = `${eventType}:${aggregateId}:${bucket}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
