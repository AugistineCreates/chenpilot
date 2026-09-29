/**
 * Shadow Execution (Issue #686) — public surface.
 *
 * Run candidate planners / policies / route policies in a side-effect-free
 * shadow path, classify divergence against the active version, and drive
 * reviewable promotion gated behind explicit thresholds.
 */

export * from "./shadow.types";
export * from "./shadow.config";
export * from "./shadow.redaction";
export * from "./shadow.executor";
export * from "./shadow.comparator";
export * from "./shadow.service";
export { ShadowComparisonRecord } from "./ShadowComparisonRecord.entity";
