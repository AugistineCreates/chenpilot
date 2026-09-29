// chenpilot/src/Agents/capability/CapabilityManager.ts
import { createHmac, randomBytes, randomUUID } from "crypto";
import logger from "../../config/logger";
import {
  CapabilityGrant,
  CapabilityValidationContext,
  CapabilityValidationResult,
  IssueGrantParams,
  AttenuateGrantParams,
} from "./types";
import {
  AuthorityBroadeningError,
  ConfusedDeputyError,
  CrossPlanReplayError,
  CrossStepReplayError,
  ReplayAttackError,
  CapabilityExpiredError,
  CapabilityRevokedError,
  CapabilityTamperedError,
  AssetLimitExceededError,
  CapabilityMissingError,
} from "./CapabilityErrors";

export class CapabilityManager {
  private readonly secretKey: string;
  private readonly DEFAULT_TTL_MS = 60000; // 1 minute default TTL
  private revokedGrants: Map<string, { revokedAt: number; reason?: string }> =
    new Map();
  private revokedPlans: Map<string, { revokedAt: number; reason?: string }> =
    new Map();
  private activeGrants: Map<string, CapabilityGrant> = new Map();

  constructor(secretKey?: string) {
    this.secretKey =
      secretKey ||
      process.env.CAPABILITY_SECRET_KEY ||
      process.env.JWT_SECRET ||
      "chenpilot-capability-secret-key-default-2026";
  }

  /**
   * Compute cryptographic HMAC-SHA256 signature over canonical grant fields
   */
  private computeSignature(grant: Omit<CapabilityGrant, "signature">): string {
    const sortedActions = [...grant.allowedActions].sort().join(",");
    const sortedLimits = grant.assetLimits
      ? Object.keys(grant.assetLimits)
          .sort()
          .map((k) => `${k}:${grant.assetLimits![k]}`)
          .join(";")
      : "";

    const canonicalPayload = [
      grant.grantId,
      grant.parentId || "",
      grant.planId,
      grant.subPlanId || "",
      grant.stepNumber !== undefined ? String(grant.stepNumber) : "",
      grant.userId,
      grant.targetAgent || "",
      grant.network,
      sortedActions,
      sortedLimits,
      grant.maxCalls !== undefined ? String(grant.maxCalls) : "1",
      String(grant.issuedAt),
      String(grant.expiresAt),
      grant.nonce,
    ].join("|");

    return createHmac("sha256", this.secretKey)
      .update(canonicalPayload)
      .digest("hex");
  }

  /**
   * Issue a new root or task-level capability grant
   */
  issueGrant(params: IssueGrantParams): CapabilityGrant {
    const now = Date.now();
    const grantId = `cap_${randomUUID()}`;
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = now + (params.ttlMs ?? this.DEFAULT_TTL_MS);

    const unsignedGrant: Omit<CapabilityGrant, "signature"> = {
      grantId,
      planId: params.planId,
      subPlanId: params.subPlanId,
      stepNumber: params.stepNumber,
      userId: params.userId,
      targetAgent: params.targetAgent,
      network: params.network ?? "all",
      allowedActions: [...params.allowedActions],
      assetLimits: params.assetLimits ? { ...params.assetLimits } : undefined,
      maxCalls: params.maxCalls ?? 1,
      usedCalls: 0,
      issuedAt: now,
      expiresAt,
      nonce,
    };

    const signature = this.computeSignature(unsignedGrant);
    const grant: CapabilityGrant = {
      ...unsignedGrant,
      signature,
    };

    this.activeGrants.set(grantId, grant);
    logger.debug("Issued capability grant", {
      grantId,
      planId: grant.planId,
      userId: grant.userId,
      actions: grant.allowedActions,
      expiresAt,
    });

    return grant;
  }

  /**
   * Attenuate an existing capability grant for delegated sub-plans or specialist agents.
   * Strictly enforces that the child grant cannot broaden authority in any dimension.
   */
  attenuateGrant(params: AttenuateGrantParams): CapabilityGrant {
    const { parentGrant } = params;
    const now = Date.now();

    // Check if parent grant is expired
    if (now > parentGrant.expiresAt) {
      throw new CapabilityExpiredError(
        `Cannot attenuate expired parent grant '${parentGrant.grantId}'`,
        { grantId: parentGrant.grantId, expiresAt: parentGrant.expiresAt }
      );
    }

    // Check if parent grant is revoked
    if (this.isRevoked(parentGrant.grantId, parentGrant.planId)) {
      throw new CapabilityRevokedError(
        `Cannot attenuate revoked parent grant '${parentGrant.grantId}'`,
        { grantId: parentGrant.grantId }
      );
    }

    // 1. Tool Actions Attenuation Check: Child actions MUST be a subset of parent actions
    const allowedActions = params.allowedActions
      ? [...params.allowedActions]
      : [...parentGrant.allowedActions];

    for (const action of allowedActions) {
      if (!parentGrant.allowedActions.includes(action)) {
        throw new AuthorityBroadeningError(
          `Cannot broaden authority: action '${action}' is not permitted by parent grant`,
          {
            requestedAction: action,
            parentAllowedActions: parentGrant.allowedActions,
          }
        );
      }
    }

    // 2. Asset Limits Attenuation Check: Child limits MUST be <= parent limits
    let assetLimits: Record<string, number> | undefined;
    if (params.assetLimits) {
      assetLimits = { ...params.assetLimits };
      if (parentGrant.assetLimits) {
        for (const [asset, childLimit] of Object.entries(assetLimits)) {
          const parentLimit = parentGrant.assetLimits[asset];
          if (parentLimit === undefined) {
            throw new AuthorityBroadeningError(
              `Cannot broaden authority: asset '${asset}' is not authorized in parent grant asset limits`,
              { asset, childLimit }
            );
          }
          if (childLimit > parentLimit) {
            throw new AuthorityBroadeningError(
              `Cannot broaden authority: limit for '${asset}' (${childLimit}) exceeds parent limit (${parentLimit})`,
              { asset, childLimit, parentLimit }
            );
          }
        }
      }
    } else if (parentGrant.assetLimits) {
      assetLimits = { ...parentGrant.assetLimits };
    }

    // 3. Network Attenuation Check: Cannot broaden from a specific network to 'all' or another network
    const network = params.network ?? parentGrant.network;
    if (parentGrant.network !== "all" && network !== parentGrant.network) {
      throw new AuthorityBroadeningError(
        `Cannot broaden network: parent grant is restricted to '${parentGrant.network}', cannot request '${network}'`,
        { parentNetwork: parentGrant.network, requestedNetwork: network }
      );
    }

    // 4. Expiration Attenuation Check: Child grant CANNOT outlive parent grant
    let expiresAt = now + (params.ttlMs ?? this.DEFAULT_TTL_MS);
    if (expiresAt > parentGrant.expiresAt) {
      // Clamped to parent expiration
      expiresAt = parentGrant.expiresAt;
    }

    // 5. Calls Limit Check: Cannot exceed remaining parent calls if bounded
    const maxCalls = params.maxCalls ?? 1;
    if (parentGrant.maxCalls !== undefined) {
      const parentRemaining = parentGrant.maxCalls - parentGrant.usedCalls;
      if (maxCalls > parentRemaining) {
        throw new AuthorityBroadeningError(
          `Cannot broaden call count: requested ${maxCalls} calls exceeds parent remaining calls (${parentRemaining})`,
          { requestedCalls: maxCalls, parentRemaining }
        );
      }
    }

    const grantId = `cap_${randomUUID()}`;
    const nonce = randomBytes(16).toString("hex");

    const unsignedGrant: Omit<CapabilityGrant, "signature"> = {
      grantId,
      parentId: parentGrant.grantId,
      planId: parentGrant.planId,
      subPlanId: params.subPlanId || parentGrant.subPlanId,
      stepNumber: params.stepNumber ?? parentGrant.stepNumber,
      userId: parentGrant.userId,
      targetAgent: params.targetAgent ?? parentGrant.targetAgent,
      network,
      allowedActions,
      assetLimits,
      maxCalls,
      usedCalls: 0,
      issuedAt: now,
      expiresAt,
      nonce,
    };

    const signature = this.computeSignature(unsignedGrant);
    const grant: CapabilityGrant = {
      ...unsignedGrant,
      signature,
    };

    this.activeGrants.set(grantId, grant);
    logger.debug("Attenuated capability grant created", {
      grantId,
      parentId: parentGrant.grantId,
      planId: grant.planId,
      actions: grant.allowedActions,
    });

    return grant;
  }

  /**
   * Validate a capability grant against a runtime tool execution context
   */
  validateGrant(
    grantOrToken: CapabilityGrant | string | undefined,
    context: CapabilityValidationContext
  ): CapabilityValidationResult {
    if (!grantOrToken) {
      return {
        valid: false,
        error: "Missing required capability grant for tool execution",
        errorCode: "GRANT_MISSING",
      };
    }

    let grant: CapabilityGrant;
    try {
      grant =
        typeof grantOrToken === "string"
          ? this.deserializeGrant(grantOrToken)
          : grantOrToken;
    } catch {
      return {
        valid: false,
        error: "Malformed capability grant token",
        errorCode: "GRANT_SIGNATURE_INVALID",
      };
    }

    // 1. Verify signature integrity
    const expectedSig = this.computeSignature(grant);
    if (grant.signature !== expectedSig) {
      return {
        valid: false,
        error:
          "Capability grant signature verification failed (tampered grant)",
        errorCode: "GRANT_SIGNATURE_INVALID",
      };
    }

    // 2. Check revocation
    if (this.isRevoked(grant.grantId, grant.planId)) {
      return {
        valid: false,
        error: `Capability grant '${grant.grantId}' has been revoked`,
        errorCode: "GRANT_REVOKED",
      };
    }

    // 3. Check expiration
    if (Date.now() > grant.expiresAt) {
      return {
        valid: false,
        error: `Capability grant expired at ${new Date(grant.expiresAt).toISOString()}`,
        errorCode: "GRANT_EXPIRED",
      };
    }

    // 4. User binding check
    if (grant.userId !== context.userId) {
      return {
        valid: false,
        error: `Confused deputy: Grant user '${grant.userId}' does not match execution user '${context.userId}'`,
        errorCode: "USER_MISMATCH",
      };
    }

    // 5. Cross-plan replay protection
    if (context.planId) {
      const isPlanMatch =
        grant.planId === context.planId ||
        grant.subPlanId === context.planId ||
        (context.subPlanId && grant.subPlanId === context.subPlanId);

      if (!isPlanMatch) {
        return {
          valid: false,
          error: `Cross-plan replay attack: Grant bound to plan '${grant.planId}'${grant.subPlanId ? ` (sub-plan '${grant.subPlanId}')` : ""} cannot be used in plan '${context.planId}'`,
          errorCode: "PLAN_MISMATCH",
        };
      }
    }

    // 6. Cross-step replay protection
    if (
      context.stepNumber !== undefined &&
      grant.stepNumber !== undefined &&
      grant.stepNumber !== context.stepNumber
    ) {
      return {
        valid: false,
        error: `Cross-step replay attack: Grant bound to step ${grant.stepNumber} cannot be used in step ${context.stepNumber}`,
        errorCode: "STEP_MISMATCH",
      };
    }

    // 7. Target agent check
    if (
      context.targetAgent &&
      grant.targetAgent &&
      grant.targetAgent !== context.targetAgent
    ) {
      return {
        valid: false,
        error: `Confused deputy: Grant bound to specialist agent '${grant.targetAgent}' cannot be executed by '${context.targetAgent}'`,
        errorCode: "CONFUSED_DEPUTY",
      };
    }

    // 8. Network check
    if (
      context.network &&
      grant.network !== "all" &&
      grant.network !== context.network
    ) {
      return {
        valid: false,
        error: `Network mismatch: Grant bound to network '${grant.network}' cannot be executed on '${context.network}'`,
        errorCode: "NETWORK_MISMATCH",
      };
    }

    // 9. Tool action check
    if (!grant.allowedActions.includes(context.action)) {
      return {
        valid: false,
        error: `Confused deputy: Action '${context.action}' is not authorized by capability grant (allowed: ${grant.allowedActions.join(", ")})`,
        errorCode: "CONFUSED_DEPUTY",
      };
    }

    // 10. Asset limit checks
    if (grant.assetLimits && context.payload) {
      const extracted = this.extractAmountAndAsset(context.payload);
      if (extracted.asset && extracted.amount !== null) {
        const upperAsset = extracted.asset.toUpperCase();
        const limit = grant.assetLimits[upperAsset];
        if (limit !== undefined && extracted.amount > limit) {
          return {
            valid: false,
            error: `Asset limit exceeded: requested ${extracted.amount} ${upperAsset} exceeds grant limit of ${limit}`,
            errorCode: "ASSET_LIMIT_EXCEEDED",
          };
        }
      }
    }

    // 11. Replay / invocation count check
    const currentGrant = this.activeGrants.get(grant.grantId) || grant;
    const maxCalls = currentGrant.maxCalls ?? 1;
    if (currentGrant.usedCalls >= maxCalls) {
      return {
        valid: false,
        error: `Replay attack detected: Grant '${grant.grantId}' has already been consumed (${currentGrant.usedCalls}/${maxCalls} calls used)`,
        errorCode: "REPLAY_DETECTED",
      };
    }

    return { valid: true };
  }

  /**
   * Validate and atomically consume a grant invocation
   */
  async consumeGrant(
    grantOrToken: CapabilityGrant | string | undefined,
    context: CapabilityValidationContext
  ): Promise<CapabilityGrant> {
    if (!grantOrToken) {
      throw new CapabilityMissingError(
        "Tool invocation rejected: missing capability grant"
      );
    }

    const validation = this.validateGrant(grantOrToken, context);
    if (!validation.valid) {
      switch (validation.errorCode) {
        case "AUTHORITY_BROADENING":
          throw new AuthorityBroadeningError(validation.error!);
        case "CONFUSED_DEPUTY":
          throw new ConfusedDeputyError(validation.error!);
        case "PLAN_MISMATCH":
          throw new CrossPlanReplayError(validation.error!);
        case "STEP_MISMATCH":
          throw new CrossStepReplayError(validation.error!);
        case "REPLAY_DETECTED":
        case "CALL_LIMIT_EXCEEDED":
          throw new ReplayAttackError(validation.error!);
        case "GRANT_EXPIRED":
          throw new CapabilityExpiredError(validation.error!);
        case "GRANT_REVOKED":
          throw new CapabilityRevokedError(validation.error!);
        case "ASSET_LIMIT_EXCEEDED":
          throw new AssetLimitExceededError(validation.error!);
        case "GRANT_MISSING":
          throw new CapabilityMissingError(validation.error!);
        case "GRANT_SIGNATURE_INVALID":
        default:
          throw new CapabilityTamperedError(
            validation.error || "Capability validation failed"
          );
      }
    }

    const grant =
      typeof grantOrToken === "string"
        ? this.deserializeGrant(grantOrToken)
        : grantOrToken;

    const storedGrant = this.activeGrants.get(grant.grantId) || grant;
    storedGrant.usedCalls += 1;
    this.activeGrants.set(grant.grantId, storedGrant);

    logger.debug("Consumed capability grant invocation", {
      grantId: grant.grantId,
      usedCalls: storedGrant.usedCalls,
      maxCalls: storedGrant.maxCalls,
      action: context.action,
    });

    return storedGrant;
  }

  /**
   * Revoke a specific capability grant
   */
  revokeGrant(grantId: string, reason?: string): void {
    this.revokedGrants.set(grantId, { revokedAt: Date.now(), reason });
    logger.warn(`Capability grant revoked: ${grantId}`, { reason });
  }

  /**
   * Revoke all capability grants bound to a plan
   */
  revokePlanGrants(planId: string, reason?: string): void {
    this.revokedPlans.set(planId, { revokedAt: Date.now(), reason });
    logger.warn(`All capability grants revoked for plan: ${planId}`, {
      reason,
    });
  }

  /**
   * Check if a grant or plan has been revoked
   */
  isRevoked(grantId: string, planId?: string): boolean {
    if (this.revokedGrants.has(grantId)) return true;
    if (planId && this.revokedPlans.has(planId)) return true;
    return false;
  }

  /**
   * Reset in-memory state (useful for tests)
   */
  reset(): void {
    this.revokedGrants.clear();
    this.revokedPlans.clear();
    this.activeGrants.clear();
  }

  /**
   * Serialize grant into a compact base64 URL-safe token
   */
  serializeGrant(grant: CapabilityGrant): string {
    return Buffer.from(JSON.stringify(grant), "utf8").toString("base64url");
  }

  /**
   * Deserialize grant from a base64 URL-safe token
   */
  deserializeGrant(token: string): CapabilityGrant {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  }

  /**
   * Helper to extract asset and numeric amount from arbitrary tool payload
   */
  private extractAmountAndAsset(payload: Record<string, unknown>): {
    amount: number | null;
    asset: string | null;
  } {
    let amount: number | null = null;
    for (const key of [
      "amount",
      "value",
      "quantity",
      "sourceAmount",
      "limit",
    ]) {
      const val = payload[key];
      if (typeof val === "number" && isFinite(val)) {
        amount = val;
        break;
      }
      if (typeof val === "string") {
        const parsed = parseFloat(val);
        if (isFinite(parsed)) {
          amount = parsed;
          break;
        }
      }
    }

    let asset: string | null = null;
    for (const key of [
      "from",
      "asset",
      "token",
      "fromToken",
      "assetCode",
      "currency",
    ]) {
      const val = payload[key];
      if (typeof val === "string" && val.trim()) {
        asset = val.trim();
        break;
      }
    }

    return { amount, asset };
  }
}

export const capabilityManager = new CapabilityManager();
