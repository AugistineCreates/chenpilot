// chenpilot/src/Agents/capability/CapabilityErrors.ts
import { CapabilityErrorCode } from "./types";

export class CapabilityError extends Error {
  readonly errorCode: CapabilityErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    errorCode: CapabilityErrorCode = "GRANT_SIGNATURE_INVALID",
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CapabilityError";
    this.errorCode = errorCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthorityBroadeningError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "AUTHORITY_BROADENING", details);
    this.name = "AuthorityBroadeningError";
  }
}

export class ConfusedDeputyError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CONFUSED_DEPUTY", details);
    this.name = "ConfusedDeputyError";
  }
}

export class CrossPlanReplayError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "PLAN_MISMATCH", details);
    this.name = "CrossPlanReplayError";
  }
}

export class CrossStepReplayError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "STEP_MISMATCH", details);
    this.name = "CrossStepReplayError";
  }
}

export class ReplayAttackError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "REPLAY_DETECTED", details);
    this.name = "ReplayAttackError";
  }
}

export class CapabilityExpiredError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "GRANT_EXPIRED", details);
    this.name = "CapabilityExpiredError";
  }
}

export class CapabilityRevokedError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "GRANT_REVOKED", details);
    this.name = "CapabilityRevokedError";
  }
}

export class CapabilityTamperedError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "GRANT_SIGNATURE_INVALID", details);
    this.name = "CapabilityTamperedError";
  }
}

export class AssetLimitExceededError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "ASSET_LIMIT_EXCEEDED", details);
    this.name = "AssetLimitExceededError";
  }
}

export class CapabilityMissingError extends CapabilityError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "GRANT_MISSING", details);
    this.name = "CapabilityMissingError";
  }
}
