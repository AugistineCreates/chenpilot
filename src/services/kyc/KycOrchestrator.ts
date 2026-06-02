import { AuditAction, AuditSeverity } from "../../AuditLog/auditLog.entity";
import { auditLogService } from "../../AuditLog/auditLog.service";
import {
  KycAction,
  KycGateContext,
  KycGateDecision,
  KycVerificationRequest,
  KycVerificationResult,
} from "./types";

export interface KycAuditSink {
  log(params: {
    userId?: string;
    action: AuditAction;
    severity?: AuditSeverity;
    resource?: string;
    metadata?: Record<string, unknown>;
    success?: boolean;
    errorMessage?: string;
  }): Promise<unknown>;
}

export class KycPolicy {
  decide(context: KycGateContext): KycGateDecision {
    if (!context.userId) {
      return {
        allowed: false,
        reason: "User identity is required for compliance-gated actions",
        requiredStatus: "approved",
      };
    }

    if (context.verificationStatus !== "approved") {
      return {
        allowed: false,
        reason: `KYC status '${context.verificationStatus || "missing"}' is not eligible for ${context.action}`,
        requiredStatus: "approved",
      };
    }

    return {
      allowed: true,
      reason: "KYC policy satisfied",
    };
  }
}

export class KycOrchestrator {
  constructor(
    private readonly policy = new KycPolicy(),
    private readonly auditSink: KycAuditSink = auditLogService
  ) {}

  async submitVerification(
    request: KycVerificationRequest,
    submit: () => Promise<KycVerificationResult>
  ): Promise<KycVerificationResult> {
    const result = await submit();

    await this.audit("submit_verification", request.person.userId, {
      provider: result.provider,
      providerReferenceId: result.providerReferenceId,
      status: result.status,
      referenceId: request.referenceId,
    });

    return result;
  }

  async gateAction(context: KycGateContext): Promise<KycGateDecision> {
    const decision = this.policy.decide(context);

    await this.audit(context.action, context.userId, {
      decision: decision.allowed ? "allow" : "deny",
      reason: decision.reason,
      verificationStatus: context.verificationStatus,
      providerReferenceId: context.providerReferenceId,
      metadata: context.metadata,
    }, decision.allowed);

    return decision;
  }

  private async audit(
    action: KycAction,
    userId: string | undefined,
    metadata: Record<string, unknown>,
    success = true
  ): Promise<void> {
    try {
      await this.auditSink.log({
        userId,
        action: AuditAction.KYC_POLICY_DECISION,
        severity: success ? AuditSeverity.INFO : AuditSeverity.WARNING,
        resource: `kyc:${action}`,
        metadata,
        success,
      });
    } catch {
      // Compliance decisions should remain available even if the audit sink is unavailable.
    }
  }
}
