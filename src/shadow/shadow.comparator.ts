/**
 * shadow.comparator.ts
 *
 * Classifies divergence between the active decision and a shadow candidate
 * decision (Issue #686, acceptance: "Divergence reports classify policy, route,
 * amount, and refusal changes").
 *
 * Divergence classes:
 *   - Refusal : active allowed && candidate refused (or vice versa)
 *   - Policy  : decision signature (allowed/reason/requiresApproval) differs
 *   - Route   : the selected asset route differs
 *   - Amount  : the proposed amount differs beyond a tolerance
 */

import {
  DivergenceClass,
  DivergenceReport,
  ShadowCandidate,
  ShadowDecision,
} from "./shadow.types";

/** Relative tolerance for amount divergence (2%). */
const AMOUNT_TOLERANCE = 0.02;

interface ActiveDecision {
  expected: Partial<ShadowDecision>;
}

export class ShadowComparator {
  /**
   * Compare the active decision against a single candidate decision and
   * produce a classified divergence report.
   *
   * `active` may be a partial expected decision (e.g. only the route, or only
   * the refusal flag) when an equivalent active decision is unavailable for a
   * subject; uncomparable facets are simply not treated as divergent.
   */
  compare(
    candidate: ShadowCandidate,
    activeDecision: ActiveDecision | Partial<ShadowDecision>,
    candidateDecision: Partial<ShadowDecision>,
    runId: string
  ): DivergenceReport {
    const active = "expected" in activeDecision &&
      activeDecision.expected != null
      ? activeDecision.expected
      : (activeDecision as Partial<ShadowDecision>);

    const details: DivergenceReport["details"] = [];
    const classes = new Set<DivergenceClass>();

    this.classifyRefusal(active, candidateDecision, details, classes);
    this.classifyPolicy(active, candidateDecision, details, classes);
    this.classifyRoute(active, candidateDecision, details, classes);
    this.classifyAmount(active, candidateDecision, details, classes);

    return {
      candidateId: candidate.id,
      subject: candidate.subject,
      version: candidate.version,
      runId,
      diverged: classes.size > 0,
      classes: [...classes],
      details,
      reviewedException: false,
      evaluatedAt: new Date().toISOString(),
    };
  }

  private classifyRefusal(
    active: Partial<ShadowDecision>,
    candidate: Partial<ShadowDecision>,
    details: DivergenceReport["details"],
    classes: Set<DivergenceClass>
  ): void {
    if (active.allowed === undefined || candidate.allowed === undefined) return;
    if (active.allowed !== candidate.allowed) {
      classes.add(DivergenceClass.Refusal);
      details.push({
        class: DivergenceClass.Refusal,
        active: { allowed: active.allowed, reason: active.reason },
        candidate: { allowed: candidate.allowed, reason: candidate.reason },
        message: `Refusal mismatch: active=${active.allowed}, candidate=${candidate.allowed}`,
      });
    }
  }

  private classifyPolicy(
    active: Partial<ShadowDecision>,
    candidate: Partial<ShadowDecision>,
    details: DivergenceReport["details"],
    classes: Set<DivergenceClass>
  ): void {
    const activeSig = active.decisionSignature;
    const candidateSig = candidate.decisionSignature;
    if (!activeSig || !candidateSig) return;
    if (activeSig !== candidateSig) {
      classes.add(DivergenceClass.Policy);
      details.push({
        class: DivergenceClass.Policy,
        active: { decisionSignature: activeSig },
        candidate: { decisionSignature: candidateSig },
        message: "Policy decision signature differs between active and candidate",
      });
    }
  }

  private classifyRoute(
    active: Partial<ShadowDecision>,
    candidate: Partial<ShadowDecision>,
    details: DivergenceReport["details"],
    classes: Set<DivergenceClass>
  ): void {
    const activeRoute = active.route;
    const candidateRoute = candidate.route;
    if (!activeRoute || !candidateRoute) return;
    const a = activeRoute.join(">");
    const c = candidateRoute.join(">");
    if (a !== c) {
      classes.add(DivergenceClass.Route);
      details.push({
        class: DivergenceClass.Route,
        active: { route: activeRoute },
        candidate: { route: candidateRoute },
        message: `Route divergence: active=${a} vs candidate=${c}`,
      });
    }
  }

  private classifyAmount(
    active: Partial<ShadowDecision>,
    candidate: Partial<ShadowDecision>,
    details: DivergenceReport["details"],
    classes: Set<DivergenceClass>
  ): void {
    if (active.amount === undefined || candidate.amount === undefined) return;
    if (active.amount == null && candidate.amount == null) return;

    const a = parseFloat(active.amount as string);
    const c = parseFloat(candidate.amount as string);
    if (!Number.isFinite(a) || !Number.isFinite(c)) return;

    const delta = Math.abs(a - c);
    const tolerance = Math.max(1e-12, Math.abs(a) * AMOUNT_TOLERANCE);
    if (delta > tolerance) {
      classes.add(DivergenceClass.Amount);
      details.push({
        class: DivergenceClass.Amount,
        active: { amount: active.amount },
        candidate: { amount: candidate.amount },
        message: `Amount divergence: active=${active.amount} vs candidate=${candidate.amount}`,
      });
    }
  }
}

export const shadowComparator = new ShadowComparator();
