export interface KeyRotationMetrics {
  batchesStarted: number;
  batchesCompleted: number;
  batchesFailed: number;
  recordsProcessed: number;
  recordsRotated: number;
  recordsSkipped: number;
  remainingReferences: number | null;
  lastBatchAt: string | null;
}

const metrics: KeyRotationMetrics = {
  batchesStarted: 0,
  batchesCompleted: 0,
  batchesFailed: 0,
  recordsProcessed: 0,
  recordsRotated: 0,
  recordsSkipped: 0,
  remainingReferences: null,
  lastBatchAt: null,
};

export function recordKeyRotationBatch(
  outcome: "started" | "completed" | "failed",
  counts?: {
    processed: number;
    rotated: number;
    skipped: number;
    remaining: number | null;
  }
): void {
  metrics.lastBatchAt = new Date().toISOString();
  if (outcome === "started") metrics.batchesStarted += 1;
  if (outcome === "failed") metrics.batchesFailed += 1;
  if (outcome === "completed") {
    metrics.batchesCompleted += 1;
    metrics.recordsProcessed += counts?.processed || 0;
    metrics.recordsRotated += counts?.rotated || 0;
    metrics.recordsSkipped += counts?.skipped || 0;
    metrics.remainingReferences = counts?.remaining ?? null;
  }
}

export function getKeyRotationMetrics(): Readonly<KeyRotationMetrics> {
  return { ...metrics };
}

export function clearKeyRotationMetrics(): void {
  Object.assign(metrics, {
    batchesStarted: 0,
    batchesCompleted: 0,
    batchesFailed: 0,
    recordsProcessed: 0,
    recordsRotated: 0,
    recordsSkipped: 0,
    remainingReferences: null,
    lastBatchAt: null,
  });
}
