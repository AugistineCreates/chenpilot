// chenpilot/src/Agents/planner/planHash.ts
import crypto from "crypto";
import { ExecutionPlan, PlanStep } from "./AgentPlanner";
import { SecretBuffer } from "../../utils/secretBuffer";

export interface ClientApproval {
  approvedAt: string;
  approverId: string;
  signature: string;
  signedHash: string;
}

export interface HashedPlan extends ExecutionPlan {
  planHash: string;
  signature?: string;
  signedBy?: string;
  signedAt?: string;
  clientApproval?: ClientApproval;
}

export interface PlanHashMetadata {
  planId: string;
  planHash: string;
  timestamp: string;
  version: string;
}

export class PlanHashService {
  private readonly HASH_VERSION = "1.0.0";
  private readonly HASH_ALGORITHM = "sha256";

  /**
   * Generate deterministic hash for an execution plan
   * The hash is based on the plan structure, ensuring any modification is detected
   */
  generatePlanHash(plan: ExecutionPlan): string {
    const canonicalPlan = this.canonicalizePlan(plan);
    const hash = crypto
      .createHash(this.HASH_ALGORITHM)
      .update(canonicalPlan)
      .digest("hex");

    return hash;
  }

  /**
   * Create a canonicalized (deterministic) string representation of the plan
   * This ensures the same plan always produces the same hash
   */
  private canonicalizePlan(plan: ExecutionPlan): string {
    const canonical = {
      version: this.HASH_VERSION,
      planId: plan.planId,
      steps: plan.steps.map((step) => this.canonicalizeStep(step)),
      totalSteps: plan.totalSteps,
      riskLevel: plan.riskLevel,
      summary: plan.summary,
    };

    return JSON.stringify(canonical, Object.keys(canonical).sort());
  }

  /**
   * Canonicalize a single step for consistent hashing
   */
  private canonicalizeStep(step: PlanStep): Record<string, unknown> {
    return {
      stepNumber: step.stepNumber,
      action: step.action,
      payload: this.sortObject(step.payload),
      description: step.description,
      dependencies: step.dependencies || [],
    };
  }

  /**
   * Recursively sort object keys for deterministic serialization
   */
  private sortObject(obj: Record<string, unknown>): Record<string, unknown> {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) =>
        typeof item === "object" && item !== null
          ? this.sortObject(item as Record<string, unknown>)
          : item
      ) as unknown as Record<string, unknown>;
    }

    const sorted: Record<string, unknown> = {};
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        const value = obj[key];
        sorted[key] =
          typeof value === "object" && value !== null
            ? this.sortObject(value as Record<string, unknown>)
            : value;
      });

    return sorted;
  }

  /**
   * Verify that a plan's hash matches its content
   */
  verifyPlanHash(plan: HashedPlan): boolean {
    const computedHash = this.generatePlanHash(plan);
    return computedHash === plan.planHash;
  }

  /**
   * Sign a plan hash with a private key (for backend signing).
   * The private key is wrapped in a SecretBuffer and zeroized after use.
   */
  signPlanHash(planHash: string, privateKey: string): string {
    const secret = SecretBuffer.fromString(privateKey, "plan-signing-key");
    try {
      return secret.consumeString((plainKey) => {
        const sign = crypto.createSign("RSA-SHA256");
        sign.update(planHash);
        sign.end();
        return sign.sign(plainKey, "base64");
      });
    } finally {
      secret.destroy();
    }
  }

  /**
   * Verify a plan signature with a public key
   */
  verifySignature(
    planHash: string,
    signature: string,
    publicKey: string
  ): boolean {
    try {
      const verify = crypto.createVerify("RSA-SHA256");
      verify.update(planHash);
      verify.end();
      return verify.verify(publicKey, signature, "base64");
    } catch {
      return false;
    }
  }

  /**
   * Sign a plan on the client side
   */
  signClientApproval(
    planHash: string,
    approverId: string,
    privateKey: string
  ): ClientApproval {
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(planHash);
    sign.end();
    const signature = sign.sign(privateKey, "base64");

    return {
      approvedAt: new Date().toISOString(),
      approverId,
      signature,
      signedHash: planHash,
    };
  }

  /**
   * Verify client approval signature
   */
  verifyClientApproval(
    planHash: string,
    clientApproval: ClientApproval,
    clientPublicKey: string
  ): boolean {
    if (clientApproval.signedHash !== planHash) {
      return false;
    }

    try {
      const verify = crypto.createVerify("RSA-SHA256");
      verify.update(clientApproval.signedHash);
      verify.end();
      return verify.verify(clientPublicKey, clientApproval.signature, "base64");
    } catch {
      return false;
    }
  }

  /**
   * Create a hashed plan with signature
   */
  createHashedPlan(
    plan: ExecutionPlan,
    privateKey?: string,
    signedBy?: string
  ): HashedPlan {
    const planHash = this.generatePlanHash(plan);
    const hashedPlan: HashedPlan = {
      ...plan,
      planHash,
    };

    if (privateKey && signedBy) {
      hashedPlan.signature = this.signPlanHash(planHash, privateKey);
      hashedPlan.signedBy = signedBy;
      hashedPlan.signedAt = new Date().toISOString();
    }

    return hashedPlan;
  }

  /**
   * Detect if a plan has been tampered with by comparing hashes
   */
  detectTampering(
    originalHash: string,
    currentPlan: ExecutionPlan
  ): {
    tampered: boolean;
    currentHash: string;
    message: string;
  } {
    const currentHash = this.generatePlanHash(currentPlan);
    const tampered = originalHash !== currentHash;

    return {
      tampered,
      currentHash,
      message: tampered
        ? "Plan has been modified! Hash mismatch detected."
        : "Plan integrity verified.",
    };
  }

  /**
   * Generate metadata for plan tracking
   */
  generateHashMetadata(plan: HashedPlan): PlanHashMetadata {
    return {
      planId: plan.planId,
      planHash: plan.planHash,
      timestamp: new Date().toISOString(),
      version: this.HASH_VERSION,
    };
  }
}

export const planHashService = new PlanHashService();
