import { PaymentExecution, PaymentExecutionResult, PaymentExecutor, PaymentRequirement } from "./paymentTypes";

export type PayoutEntryStatus = "pending" | "invalid" | "processing" | "succeeded" | "failed" | "ambiguous";
export type BatchPayoutStatus = "draft" | "approved" | "processing" | "completed";

export interface PayoutManifestEntry {
  id: string;
  requirement: PaymentRequirement;
}

export interface PayoutManifest {
  id: string;
  entries: PayoutManifestEntry[];
}

export interface PayoutEntryOutcome {
  entryId: string;
  status: PayoutEntryStatus;
  transactionHash?: string;
  error?: string;
}

export interface BatchPayoutWorkflow {
  id: string;
  manifest: PayoutManifest;
  manifestHash: string;
  approvalHash?: string;
  status: BatchPayoutStatus;
  outcomes: PayoutEntryOutcome[];
}

export class BatchPayoutWorkflowService {
  private readonly workflows = new Map<string, BatchPayoutWorkflow>();

  constructor(private readonly executor: PaymentExecutor) {}

  validateAndCreate(manifest: PayoutManifest): BatchPayoutWorkflow {
    if (this.workflows.has(manifest.id)) throw new Error(`Batch already exists: ${manifest.id}`);

    const seen = new Set<string>();
    const outcomes = manifest.entries.map((entry): PayoutEntryOutcome => {
      const duplicate = seen.has(entry.id);
      seen.add(entry.id);
      const error = duplicate
        ? "duplicate_entry"
        : !entry.requirement.recipient
          ? "missing_recipient"
          : !entry.requirement.amount
            ? "missing_amount"
            : undefined;

      return { entryId: entry.id, status: error ? "invalid" : "pending", error };
    });

    const workflow: BatchPayoutWorkflow = {
      id: manifest.id,
      manifest: this.cloneManifest(manifest),
      manifestHash: hashManifest(manifest),
      status: "draft",
      outcomes,
    };
    this.workflows.set(workflow.id, workflow);
    return this.cloneWorkflow(workflow);
  }

  approve(id: string, manifestHash: string): BatchPayoutWorkflow {
    const workflow = this.requireWorkflow(id);
    if (manifestHash !== workflow.manifestHash) {
      throw new Error("Approval does not match payout manifest");
    }
    if (workflow.outcomes.some((outcome) => outcome.status === "invalid")) {
      throw new Error("Cannot approve payout manifest with invalid entries");
    }
    workflow.status = "approved";
    workflow.approvalHash = manifestHash;
    return this.cloneWorkflow(workflow);
  }

  async execute(id: string): Promise<BatchPayoutWorkflow> {
    const workflow = this.requireWorkflow(id);
    if (workflow.status !== "approved" && workflow.status !== "processing") {
      throw new Error(`Batch is not approved: ${id}`);
    }
    workflow.status = "processing";

    for (const outcome of workflow.outcomes) {
      if (!["pending", "failed", "ambiguous"].includes(outcome.status)) continue;
      const entry = workflow.manifest.entries.find((candidate) => candidate.id === outcome.entryId);
      if (!entry) continue;

      outcome.status = "processing";
      const result = await this.executor.executePayment(this.executionFor(workflow, entry));
      applyResult(outcome, result);
    }

    workflow.status = workflow.outcomes.every((outcome) =>
      ["succeeded", "invalid"].includes(outcome.status)
    )
      ? "completed"
      : "processing";
    return this.cloneWorkflow(workflow);
  }

  getWorkflow(id: string): BatchPayoutWorkflow | undefined {
    const workflow = this.workflows.get(id);
    return workflow ? this.cloneWorkflow(workflow) : undefined;
  }

  private executionFor(workflow: BatchPayoutWorkflow, entry: PayoutManifestEntry): PaymentExecution {
    return {
      idempotencyKey: `${workflow.id}:${workflow.manifestHash}:${entry.id}`,
      requirement: entry.requirement,
      metadata: { batchId: workflow.id, manifestHash: workflow.manifestHash, entryId: entry.id },
    };
  }

  private requireWorkflow(id: string): BatchPayoutWorkflow {
    const workflow = this.workflows.get(id);
    if (!workflow) throw new Error(`Unknown batch payout workflow: ${id}`);
    return workflow;
  }

  private cloneManifest(manifest: PayoutManifest): PayoutManifest {
    return {
      id: manifest.id,
      entries: manifest.entries.map((entry) => ({
        id: entry.id,
        requirement: {
          ...entry.requirement,
          asset: { ...entry.requirement.asset },
        },
      })),
    };
  }

  private cloneWorkflow(workflow: BatchPayoutWorkflow): BatchPayoutWorkflow {
    return {
      ...workflow,
      manifest: this.cloneManifest(workflow.manifest),
      outcomes: workflow.outcomes.map((outcome) => ({ ...outcome })),
    };
  }
}

function applyResult(outcome: PayoutEntryOutcome, result: PaymentExecutionResult): void {
  outcome.status = result.status === "success" ? "succeeded" : result.status;
  outcome.transactionHash = result.transactionHash;
  outcome.error = result.error;
}

function hashManifest(manifest: PayoutManifest): string {
  const canonical = JSON.stringify({
    id: manifest.id,
    entries: manifest.entries.map((entry) => ({
      id: entry.id,
      requirement: {
        network: entry.requirement.network,
        asset: {
          code: entry.requirement.asset.code,
          issuer: entry.requirement.asset.issuer ?? "",
        },
        amount: entry.requirement.amount,
        recipient: entry.requirement.recipient,
      },
    })),
  });

  let hash = 0;
  for (let i = 0; i < canonical.length; i += 1) {
    hash = Math.imul(31, hash) + canonical.charCodeAt(i);
    hash |= 0;
  }
  return `manifest-${(hash >>> 0).toString(16)}`;
}
