/**
 * shadow.executor.ts
 *
 * Runs candidate planners, policies and route policies in a side-effect-free
 * shadow path alongside the active version (Issue #686).
 *
 * Safety model (acceptance: "Shadow execution has no credentials capable of
 * mutation"):
 *   - The executor never signs, submits or writes to chain state. It only
 *     invokes injected, read-only decision functions.
 *   - Candidate and active evaluators are supplied externally; they are
 *     expected to be pure/read-only (planner, policy gate, route evaluation).
 *     Heavy read-only work (e.g. path finding) runs inside a timeout so a
 *     misbehaving candidate cannot hang production decision latency.
 *   - Inputs are privacy-filtered before any comparison or persistence.
 */

import { ShadowCandidate, ShadowConfig, ShadowDecision } from "./shadow.types";
import { filterShadowInput } from "./shadow.redaction";
import { ShadowComparator } from "./shadow.comparator";
import { DivergenceReport } from "./shadow.types";

/** A read-only decision function for a shadow subject. */
export type DecisionEvaluator = (
  config: Record<string, unknown>,
  input: Record<string, unknown>
) => Promise<Partial<ShadowDecision>> | Partial<ShadowDecision>;

export interface ShadowRunOptions {
  /** Active decision to compare against. May be partial per subject. */
  active?: Partial<ShadowDecision>;
  runId: string;
  timeoutMs?: number;
}

export class ShadowExecutor {
  constructor(
    private readonly comparator: ShadowComparator,
    private readonly config: Pick<ShadowConfig, "sampleRatePct">
  ) {}

  /**
   * Deterministically decide whether this request mirrors into shadow, based
   * on a stable hash of the run id and the configured sample rate.
   */
  sampled(runId: string): boolean {
    const rate = this.config.sampleRatePct / 100;
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    // Stable hash in [0,1) for the run id — reproducible sampling.
    let hash = 2166136261;
    for (let i = 0; i < runId.length; i++) {
      hash ^= runId.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const normalized = (hash >>> 0) / 0xffffffff;
    return normalized < rate;
  }

  /**
   * Execute a single candidate in the shadow path and compare it with the
   * active decision. Returns a classified divergence report.
   *
   * The returned report never contains raw (unredacted) input.
   */
  async runCandidate(
    candidate: ShadowCandidate,
    input: Record<string, unknown>,
    options: ShadowRunOptions
  ): Promise<DivergenceReport> {
    const redactedInput = filterShadowInput(input);
    const timeoutMs = options.timeoutMs ?? 5000;

    const guarded: DecisionEvaluator = (config, inp) =>
      this.withTimeout(
        (async () => {

          const decision = await (candidate.subject === "planner"
            ? this.evaluatePlanner(candidate.config, inp, redactedInput)
            : candidate.subject === "policy"
              ? this.evaluatePolicy(candidate.config, inp)
              : this.evaluateRoute(candidate.config, inp));
          return decision;
        })(),
        timeoutMs
      );

    // Capture active decision deterministically (re-run active evaluation if
    // not provided) so the comparison is apples-to-apples.
    const activeDecision =
      options.active ??
      (await guarded(candidate.config, redactedInput));

    const candidateDecision = await guarded(candidate.config, redactedInput);

    const report = this.comparator.compare(
      candidate,
      activeDecision,
      candidateDecision,
      options.runId
    );
    report.reviewedException = !!candidate.reviewRequired;
    return report;
  }

  /**
   * Read-only planner evaluator: produce a decision signature + plan hash from
   * config interpreted as planner constraints. Never executes anything.
   */
  private async evaluatePlanner(
    config: Record<string, unknown>,
    input: Record<string, unknown>,
    redactedInput: Record<string, unknown>
  ): Promise<Partial<ShadowDecision>> {
    const signature = this.signatureOf({
      action: String(input.action ?? "plan"),
      allowed: config.allowPlan !== false,
      reason: config.allowPlan === false ? "plan candidate refused" : undefined,
    });
    return {
      subject: "planner",
      version: String(config.version ?? "unknown"),
      action: String(input.action ?? "plan"),
      allowed: config.allowPlan !== false,
      reason: config.allowPlan === false ? "plan candidate refused" : undefined,
      requiresApproval: config.requiresApproval === true,
      decisionSignature: signature,
      planHash: this.planHash(signature),
      redactedInput,
    };
  }

  private async evaluatePolicy(
    config: Record<string, unknown>,
    input: Record<string, unknown>
  ): Promise<Partial<ShadowDecision>> {
    const allowed = config.allow !== false;
    const maxScore = typeof config.maxScore === "number" ? config.maxScore : 100;
    const proposedScore = typeof input.riskScore === "number" ? input.riskScore : 0;
    const actuallyAllowed = allowed && proposedScore <= maxScore;
    const requiresApproval =
      config.requiresApproval === true || (actuallyAllowed && proposedScore > 50);

    return {
      subject: "policy",
      version: String(config.version ?? "unknown"),
      action: String(input.action ?? "unknown"),
      allowed: actuallyAllowed,
      reason: actuallyAllowed
        ? undefined
        : configuredReason(config) || `candidate policy refused (score ${proposedScore} > ${maxScore})`,
      requiresApproval,
      decisionSignature: this.signatureOf({ action: input.action, allowed: actuallyAllowed, requiresApproval }),
      amount: input.amount != null ? String(input.amount) : undefined,
      redactedInput: {} as Record<string, unknown>,
    };
  }

  private async evaluateRoute(
    config: Record<string, unknown>,
    input: Record<string, unknown>
  ): Promise<Partial<ShadowDecision>> {
    const route = Array.isArray(config.route)
      ? (config.route as string[])
      : input.route
        ? String(input.route).split(">")
        : ["XLM", "USDC"];
    const amount =
      input.amount != null ? String(input.amount) : config.amount != null ? String(config.amount) : undefined;

    return {
      subject: "route",
      version: String(config.version ?? "unknown"),
      action: String(input.action ?? "route"),
      allowed: true,
      route,
      amount,
      decisionSignature: this.signatureOf({ action: input.action, route: route.join(">") }),
      redactedInput: {} as Record<string, unknown>,
    };
  }

  private signatureOf(fields: Record<string, unknown>): string {
    const c = JSON.stringify(fields, Object.keys(fields).sort());
    let hash = 0;
    for (let i = 0; i < c.length; i++) {
      hash = (hash << 5) - hash + c.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }

  private planHash(signature: string): string {
    // Deterministic stand-in for a full canonical plan hash; kept stable so a
    // given signature always maps to the same hash.
    return `sha256-${this.signatureOf({ signature })}`;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Shadow evaluation timed out after ${ms}ms`)), ms)
      ),
    ]);
  }
}

function configuredReason(config: Record<string, unknown>): string | undefined {
  return typeof config.reason === "string" ? (config.reason as string) : undefined;
}
