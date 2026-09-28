import {
  Clock,
  PaymentExecution,
  PaymentExecutionResult,
  PaymentExecutor,
  PaymentRequirement,
  systemClock,
} from "./paymentTypes";
import { addAmount, compareAmount } from "./money";

export type MandateStatus = "active" | "revoked";
export type MandateRunStatus = "pending" | "processing" | "succeeded" | "failed" | "ambiguous" | "missed";
export type MissedRunBehavior = "skip" | "execute_late";

export interface PaymentMandate {
  id: string;
  requirement: PaymentRequirement;
  intervalMs: number;
  nextRunAt: Date;
  cumulativeLimit: string;
  spentAmount: string;
  approvalRequired: boolean;
  approved: boolean;
  missedRunBehavior: MissedRunBehavior;
  status: MandateStatus;
  revokedAt?: Date;
}

export interface PaymentMandateRun {
  id: string;
  mandateId: string;
  scheduledFor: Date;
  status: MandateRunStatus;
  transactionHash?: string;
  error?: string;
}

export class RecurringPaymentMandateService {
  private readonly mandates = new Map<string, PaymentMandate>();
  private readonly runs = new Map<string, PaymentMandateRun>();
  private readonly locks = new Set<string>();

  constructor(
    private readonly executor: PaymentExecutor,
    private readonly clock: Clock = systemClock
  ) {}

  createMandate(mandate: Omit<PaymentMandate, "spentAmount" | "status">): PaymentMandate {
    if (this.mandates.has(mandate.id)) throw new Error(`Mandate already exists: ${mandate.id}`);
    const created: PaymentMandate = {
      ...mandate,
      spentAmount: "0",
      status: "active",
    };
    this.mandates.set(created.id, created);
    return this.cloneMandate(created);
  }

  approveMandate(id: string): PaymentMandate {
    const mandate = this.requireMandate(id);
    mandate.approved = true;
    return this.cloneMandate(mandate);
  }

  revokeMandate(id: string, revokedAt = this.clock.now()): PaymentMandate {
    const mandate = this.requireMandate(id);
    mandate.status = "revoked";
    mandate.revokedAt = revokedAt;
    return this.cloneMandate(mandate);
  }

  async runDueMandates(now = this.clock.now()): Promise<PaymentMandateRun[]> {
    const results: PaymentMandateRun[] = [];
    for (const mandate of this.mandates.values()) {
      const run = await this.runMandateIfDue(mandate.id, now);
      if (run) results.push(run);
    }
    return results;
  }

  async runMandateIfDue(id: string, now = this.clock.now()): Promise<PaymentMandateRun | undefined> {
    const mandate = this.requireMandate(id);
    if (mandate.status !== "active" || mandate.nextRunAt.getTime() > now.getTime()) return undefined;
    if (mandate.approvalRequired && !mandate.approved) {
      throw new Error(`Mandate requires approval: ${id}`);
    }
    if (this.locks.has(id)) return undefined;

    const runId = this.runId(id, mandate.nextRunAt);
    const existing = this.runs.get(runId);
    if (existing && existing.status !== "failed") return this.cloneRun(existing);

    this.locks.add(id);
    const run: PaymentMandateRun = existing ?? {
      id: runId,
      mandateId: id,
      scheduledFor: new Date(mandate.nextRunAt),
      status: "pending",
    };
    this.runs.set(run.id, run);

    try {
      if (
        mandate.missedRunBehavior === "skip" &&
        now.getTime() - mandate.nextRunAt.getTime() >= mandate.intervalMs
      ) {
        run.status = "missed";
        mandate.nextRunAt = new Date(now.getTime() + mandate.intervalMs);
        return this.cloneRun(run);
      }

      const projectedSpend = addAmount(mandate.spentAmount, mandate.requirement.amount);
      if (compareAmount(projectedSpend, mandate.cumulativeLimit) > 0) {
        run.status = "failed";
        run.error = "cumulative_limit_exceeded";
        return this.cloneRun(run);
      }

      run.status = "processing";
      const result = await this.executor.executePayment(this.executionFor(mandate, run));
      run.status = result.status === "success" ? "succeeded" : result.status;
      run.transactionHash = result.transactionHash;
      run.error = result.error;

      if (result.status === "success") {
        mandate.spentAmount = projectedSpend;
        mandate.nextRunAt = new Date(mandate.nextRunAt.getTime() + mandate.intervalMs);
      }
      return this.cloneRun(run);
    } finally {
      this.locks.delete(id);
    }
  }

  getMandate(id: string): PaymentMandate | undefined {
    const mandate = this.mandates.get(id);
    return mandate ? this.cloneMandate(mandate) : undefined;
  }

  listRuns(mandateId: string): PaymentMandateRun[] {
    return [...this.runs.values()]
      .filter((run) => run.mandateId === mandateId)
      .map((run) => this.cloneRun(run));
  }

  private executionFor(mandate: PaymentMandate, run: PaymentMandateRun): PaymentExecution {
    return {
      idempotencyKey: run.id,
      requirement: mandate.requirement,
      metadata: { mandateId: mandate.id, scheduledFor: run.scheduledFor.toISOString() },
    };
  }

  private runId(mandateId: string, scheduledFor: Date): string {
    return `${mandateId}:${scheduledFor.toISOString()}`;
  }

  private requireMandate(id: string): PaymentMandate {
    const mandate = this.mandates.get(id);
    if (!mandate) throw new Error(`Unknown mandate: ${id}`);
    return mandate;
  }

  private cloneMandate(mandate: PaymentMandate): PaymentMandate {
    return {
      ...mandate,
      nextRunAt: new Date(mandate.nextRunAt),
      revokedAt: mandate.revokedAt ? new Date(mandate.revokedAt) : undefined,
    };
  }

  private cloneRun(run: PaymentMandateRun): PaymentMandateRun {
    return { ...run, scheduledFor: new Date(run.scheduledFor) };
  }
}
