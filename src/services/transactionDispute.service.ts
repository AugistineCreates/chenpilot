export type DisputeStatus = "open" | "investigating" | "resolved" | "rejected";

export interface DisputeEvidence {
  id: string;
  redactedText?: string;
  attachmentUri?: string;
  addedBy: string;
  addedAt: Date;
}

export interface DisputeCase {
  id: string;
  userId: string;
  transactionId: string;
  workflowId: string;
  status: DisputeStatus;
  ownerId: string;
  investigatorId?: string;
  outcome?: string;
  evidence: DisputeEvidence[];
  transitions: Array<{ from?: DisputeStatus; to: DisputeStatus; actorId: string; at: Date; reason?: string }>;
  createdAt: Date;
  updatedAt: Date;
}

export class TransactionDisputeService {
  private disputes = new Map<string, DisputeCase>();

  report(params: {
    userId: string;
    transactionId: string;
    workflowId: string;
    evidence?: string;
  }): DisputeCase {
    const existing = [...this.disputes.values()].find(
      (dispute) =>
        dispute.userId === params.userId &&
        dispute.transactionId === params.transactionId &&
        !["resolved", "rejected"].includes(dispute.status),
    );
    if (existing) return this.clone(existing);

    const now = new Date();
    const dispute: DisputeCase = {
      id: crypto.randomUUID(),
      userId: params.userId,
      ownerId: params.userId,
      transactionId: params.transactionId,
      workflowId: params.workflowId,
      status: "open",
      evidence: params.evidence
        ? [
            {
              id: crypto.randomUUID(),
              redactedText: this.redact(params.evidence),
              addedBy: params.userId,
              addedAt: now,
            },
          ]
        : [],
      transitions: [{ to: "open", actorId: params.userId, at: now, reason: "reported" }],
      createdAt: now,
      updatedAt: now,
    };
    this.disputes.set(dispute.id, dispute);
    return this.clone(dispute);
  }

  assign(disputeId: string, investigatorId: string, actor: { id: string; roles: string[] }): DisputeCase {
    this.assertInvestigator(actor);
    const dispute = this.requireDispute(disputeId);
    dispute.investigatorId = investigatorId;
    this.transition(dispute, "investigating", actor.id, "assigned");
    return this.save(dispute);
  }

  addEvidence(disputeId: string, text: string, actor: { id: string; roles: string[] }): DisputeCase {
    const dispute = this.requireDispute(disputeId);
    if (actor.id !== dispute.ownerId) this.assertInvestigator(actor);
    dispute.evidence.push({
      id: crypto.randomUUID(),
      redactedText: this.redact(text),
      addedBy: actor.id,
      addedAt: new Date(),
    });
    dispute.updatedAt = new Date();
    return this.save(dispute);
  }

  resolve(
    disputeId: string,
    status: Extract<DisputeStatus, "resolved" | "rejected">,
    outcome: string,
    actor: { id: string; roles: string[] },
  ): DisputeCase {
    this.assertInvestigator(actor);
    const dispute = this.requireDispute(disputeId);
    dispute.outcome = outcome;
    this.transition(dispute, status, actor.id, outcome);
    return this.save(dispute);
  }

  getVisibleProgress(disputeId: string, actor: { id: string; roles: string[] }): Pick<DisputeCase, "id" | "status" | "transactionId" | "workflowId" | "outcome" | "transitions"> {
    const dispute = this.requireDispute(disputeId);
    if (actor.id !== dispute.ownerId) this.assertInvestigator(actor);
    return {
      id: dispute.id,
      status: dispute.status,
      transactionId: dispute.transactionId,
      workflowId: dispute.workflowId,
      outcome: dispute.outcome,
      transitions: dispute.transitions.map((transition) => ({ ...transition })),
    };
  }

  private transition(dispute: DisputeCase, to: DisputeStatus, actorId: string, reason?: string): void {
    const from = dispute.status;
    dispute.status = to;
    dispute.transitions.push({ from, to, actorId, reason, at: new Date() });
    dispute.updatedAt = new Date();
  }

  private redact(text: string): string {
    return text
      .replace(/S[A-Z0-9]{55}/g, "[REDACTED_SECRET_KEY]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]");
  }

  private assertInvestigator(actor: { roles: string[] }): void {
    if (!actor.roles.includes("investigator") && !actor.roles.includes("admin")) {
      throw new Error("Investigator access required");
    }
  }

  private requireDispute(disputeId: string): DisputeCase {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) throw new Error("Dispute case not found");
    return this.clone(dispute);
  }

  private save(dispute: DisputeCase): DisputeCase {
    this.disputes.set(dispute.id, this.clone(dispute));
    return this.clone(dispute);
  }

  private clone(dispute: DisputeCase): DisputeCase {
    return {
      ...dispute,
      evidence: dispute.evidence.map((evidence) => ({ ...evidence })),
      transitions: dispute.transitions.map((transition) => ({ ...transition })),
    };
  }
}

export const transactionDisputeService = new TransactionDisputeService();
