// chenpilot/src/Agents/capability/CapabilityValidator.ts
import { capabilityManager } from "./CapabilityManager";
import { CapabilityGrant, CapabilityValidationContext } from "./types";
import { CapabilityMissingError } from "./CapabilityErrors";
import logger from "../../config/logger";

export interface CapabilityValidationOptions {
  /** If true, missing grant will throw CapabilityMissingError; if false, missing grant is permitted (backward-compatible) */
  requireGrant?: boolean;
}

export class CapabilityValidator {
  /**
   * Validate and consume a capability grant for a tool execution before any side effects occur.
   */
  static async validateToolCall(
    action: string,
    payload: Record<string, unknown>,
    userId: string,
    grant?: CapabilityGrant | string,
    context: Partial<CapabilityValidationContext> = {},
    options: CapabilityValidationOptions = {}
  ): Promise<CapabilityGrant | undefined> {
    if (!grant) {
      if (options.requireGrant) {
        logger.warn(
          `Capability validation failed: grant required for action '${action}'`,
          { action, userId }
        );
        throw new CapabilityMissingError(
          `Tool execution rejected: action '${action}' requires an attenuated capability grant`
        );
      }
      return undefined;
    }

    const fullContext: CapabilityValidationContext = {
      action,
      payload,
      userId,
      planId: context.planId,
      subPlanId: context.subPlanId,
      stepNumber: context.stepNumber,
      targetAgent: context.targetAgent,
      network: context.network,
    };

    logger.debug(`Validating capability grant for action '${action}'`, {
      action,
      userId,
      planId: context.planId,
      stepNumber: context.stepNumber,
    });

    return await capabilityManager.consumeGrant(grant, fullContext);
  }
}
