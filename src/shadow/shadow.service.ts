/**
 * shadow.service.ts
 *
 * Shadow Execution coordinator (Issue #686). Provides:
 *   - a candidate registry for planner/policy/route candidates,
 *   - a bounded shadow store of divergence reports with retention semantics,
 *   - promotion eligibility computed against explicit thresholds, with a
 *     "reviewed exception" path that requires explicit approvals,
 *   - a single entry point `mirror` that runs candidate decisions in shadow.
 *
 * Shadow execution is side-effect-free by construction: it never holds
 * credentials capable of mutation and never persists unredacted inputs.
 */

import {
  DivergenceClass,
  DivergenceReport,
  PromotionEligibility,
  ShadowCandidate,
  ShadowConfig,
  ShadowDecision,
} from "./shadow.types";
import { shadowConfig as defaultConfig } from "./shadow.config";
import {
  ShadowExecutor,
} from "./shadow.executor";
import { shadowComparator } from "./shadow.comparator";

export interface MirrorOptions {
  runId: string;
  input: Record<string, unknown>;
  /** Active decision produced by the production path. May be partial. */
  active?: Partial<ShadowDecision>;
}

export class ShadowService {
  private readonly candidates = new Map<string, ShadowCandidate>();
  /** Bounded, ordered divergence store (oldest first). */
  private readonly store: DivergenceReport[] = [];

  constructor(private readonly config: ShadowConfig = defaultConfig) {
    this.executor = new ShadowExecutor(shadowComparator, config);
  }

  private readonly executor: ShadowExecutor;

  register(candidate: ShadowCandidate): void {
    if (!this.config.enabled) return;
    this.candidates.set(candidate.id, candidate);
  }

  listCandidates(): ShadowCandidate[] {
    return [...this.candidates.values()];
  }

  /**
   * Mirror all registered (non-retired, relevant to the subject) candidates in
   * the shadow path for a single production decision. Returns the divergence
   * reports; never throws on candidate failure (a failing shadow decision is
   * recorded as a divergence, production is unaffected).
   */
  async mirror(opts: MirrorOptions): Promise<DivergenceReport[]> {
    if (!this.config.enabled) {
      return [];
    }
    if (!this.executor.sampled(opts.runId)) {
      return [];
    }

    const reports: DivergenceReport[] = [];
    for (const candidate of [...this.candidates.values()]) {
      if (candidate.status === "retired") continue;
      if (candidate.subject !== subjectOf(opts.active) && !["policy", "planner", "route"].includes(candidate.subject)) {
        continue;
      }
      try {
        const report = await this.executor.runCandidate(
          candidate,
          opts.input,
          { runId: opts.runId, active: opts.active }
        );
        this.record(report);
        reports.push(report);
      } catch (error) {
        reports.push(this.failedReport(candidate, opts.runId, error));
      }
    }
    return reports;
  }

  /**
   * Compute promotion eligibility for a candidate against explicit thresholds
   * (minimum evaluations, maximum divergence rate) and the reviewed-exception
   * approval count.
   */
  eligibility(candidateId: string): PromotionEligibility {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) {
      return {
        eligible: false,
        subject: "policy",
        candidateId,
        version: "unknown",
        evaluations: 0,
        divergenceRate: 1,
        reason: "Candidate not registered",
      };
    }

    const records = this.store.filter((r) => r.candidateId === candidateId);
    const evaluations = records.length;

    const diverged = records.filter((r) => r.diverged && !r.reviewedException).length;
    const divergenceRate = evaluations === 0 ? 1 : diverged / evaluations;

    if (evaluations < this.config.promotionMinEvaluations) {
      return {
        eligible: false,
        subject: candidate.subject,
        candidateId,
        version: candidate.version,
        evaluations,
        divergenceRate,
        reason: `Insufficient evaluations: ${evaluations} < ${this.config.promotionMinEvaluations}`,
      };
    }

    if (divergenceRate > this.config.promotionMaxDivergenceRate) {
      return {
        eligible: false,
        subject: candidate.subject,
        candidateId,
        version: candidate.version,
        evaluations,
        divergenceRate,
        reason: `Divergence rate ${divergenceRate.toFixed(4)} exceeds threshold ${this.config.promotionMaxDivergenceRate}`,
      };
    }

    const requiresReview = candidate.reviewRequired && this.config.promotionRequiredApprovals > 0;
    return {
      eligible: true,
      subject: candidate.subject,
      candidateId,
      version: candidate.version,
      evaluations,
      divergenceRate,
      reason: requiresReview
        ? `Eligible pending ${this.config.promotionRequiredApprovals} reviewed exception approval(s)`
        : "Eligible: divergence within threshold",
    };
  }

  /** Mark a candidate promoted to active (the shadow promotion gate passed). */
  promote(candidateId: string, reviewedBy?: string): boolean {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return false;
    const el = this.eligibility(candidateId);
    if (!el.eligible) return false;
    if (candidate.reviewRequired && !reviewedBy) return false;
    candidate.status = "active";
    return true;
  }

  getReports(candidateId?: string, limit = 100): DivergenceReport[] {
    const recent = candidateId
      ? this.store.filter((r) => r.candidateId === candidateId)
      : this.store;
    return recent.slice(-Math.max(0, limit));
  }

  /**
   * Retention: purge records older than the configured retention window and
   * enforce the hard maximum record count (defensive bound).
   */
  enforceRetention(now = Date.now()): number {
    const cutoffMs = now - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const before = this.store.length;
    let i = 0;
    while (i < this.store.length) {
      const ts = Date.parse(this.store[i].evaluatedAt);
      if (Number.isFinite(ts) && ts < cutoffMs) {
        this.store.splice(i, 1);
      } else {
        i++;
      }
    }
    const overflow = this.store.length - this.config.maxRecords;
    if (overflow > 0) {
      this.store.splice(0, overflow);
    }
    return before - this.store.length;
  }

  private record(report: DivergenceReport): void {
    this.store.push(report);
  }

  private failedReport(
    candidate: ShadowCandidate,
    runId: string,
    error: unknown
  ): DivergenceReport {
    return {
      candidateId: candidate.id,
      subject: candidate.subject,
      version: candidate.version,
      runId,
      diverged: true,
      classes: [DivergenceClass.Policy],
      details: [
        {
          class: DivergenceClass.Policy,
          message: `Shadow evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      reviewedException: false,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

function subjectOf(active?: Partial<ShadowDecision>): string | undefined {
  return active?.subject;
}

export const shadowService = new ShadowService();
