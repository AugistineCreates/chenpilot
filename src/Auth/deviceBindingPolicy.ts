/**
 * Device Binding and Step-Up Policy Enforcement (#659.3)
 * 
 * This module implements security policies around device binding:
 * 1. Device identification and tracking
 * 2. Risk assessment on device changes
 * 3. Step-up authentication requirements
 * 4. Risk-based conditional access
 */

import { trustedTimeManager } from "../services/clock/trustedTime.manager";

/**
 * Device binding and risk-based access control policies.
 */
export interface DevicePolicy {
  /**
   * Require step-up (MFA/re-authentication) for new devices.
   */
  requireStepUpOnNewDevice: boolean;

  /**
   * Require step-up if risk level exceeds threshold.
   */
  requireStepUpIfRiskLevelExceeds: "LOW" | "MEDIUM" | "HIGH";

  /**
   * Allow token refresh within N days on same device without step-up.
   */
  allowRefreshWithinDaysOnSameDevice: number;

  /**
   * Block refresh if device not seen for N days.
   */
  blockRefreshIfDeviceNotSeenFor: number;

  /**
   * Allow session sharing across multiple devices.
   */
  allowMultiDeviceSession: boolean;

  /**
   * Maximum number of active devices per user.
   */
  maxActiveDevicesPerUser: number;
}

/**
 * Default policy: Balance between security and usability.
 */
export const defaultDevicePolicy: DevicePolicy = {
  requireStepUpOnNewDevice: true,
  requireStepUpIfRiskLevelExceeds: "MEDIUM",
  allowRefreshWithinDaysOnSameDevice: 7,
  blockRefreshIfDeviceNotSeenFor: 90,
  allowMultiDeviceSession: true,
  maxActiveDevicesPerUser: 5,
};

/**
 * Strict policy: High security requirement.
 * Suitable for financial or medical applications.
 */
export const strictDevicePolicy: DevicePolicy = {
  requireStepUpOnNewDevice: true,
  requireStepUpIfRiskLevelExceeds: "LOW",
  allowRefreshWithinDaysOnSameDevice: 1,
  blockRefreshIfDeviceNotSeenFor: 7,
  allowMultiDeviceSession: false, // One device per session
  maxActiveDevicesPerUser: 1,
};

/**
 * Permissive policy: User convenience prioritized.
 * Suitable for non-sensitive applications.
 */
export const permissiveDevicePolicy: DevicePolicy = {
  requireStepUpOnNewDevice: false,
  requireStepUpIfRiskLevelExceeds: "HIGH",
  allowRefreshWithinDaysOnSameDevice: 30,
  blockRefreshIfDeviceNotSeenFor: 180,
  allowMultiDeviceSession: true,
  maxActiveDevicesPerUser: 10,
};

/**
 * Policy evaluation result.
 */
export interface PolicyEvaluationResult {
  /**
   * Should step-up (MFA) be required?
   */
  requiresStepUp: boolean;

  /**
   * Should token refresh be blocked?
   */
  shouldBlock: boolean;

  /**
   * Reasons for any blocks or step-ups.
   */
  reasons: string[];

  /**
   * Risk level that triggered policies.
   */
  triggeredRiskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

/**
 * Device binding context for policy evaluation.
 */
export interface DeviceBindingContext {
  /**
   * Current device ID.
   */
  currentDeviceId: string;

  /**
   * Last known device ID for this user.
   */
  lastKnownDeviceId: string | null;

  /**
   * Days since device was last used.
   */
  daysSinceLastSeen: number;

  /**
   * Risk level of current session.
   */
  riskLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

  /**
   * Whether device is in user's historical device list.
   */
  isKnownDevice: boolean;

  /**
   * Number of active devices for user.
   */
  activeDeviceCount: number;
}

/**
 * Evaluate device binding policy.
 * 
 * Returns whether step-up authentication is required and whether access should be blocked.
 */
export function evaluateDevicePolicy(
  context: DeviceBindingContext,
  policy: DevicePolicy = defaultDevicePolicy
): PolicyEvaluationResult {
  const reasons: string[] = [];
  let requiresStepUp = false;
  let shouldBlock = false;
  let triggeredRiskLevel: PolicyEvaluationResult["triggeredRiskLevel"] = undefined;

  // Check: New device requires step-up
  if (policy.requireStepUpOnNewDevice && !context.isKnownDevice) {
    requiresStepUp = true;
    reasons.push("New device detected");
  }

  // Check: Device changed requires step-up
  if (
    policy.requireStepUpOnNewDevice &&
    context.currentDeviceId !== context.lastKnownDeviceId
  ) {
    requiresStepUp = true;
    reasons.push("Device changed from last session");
  }

  // Check: Risk level too high
  const riskLevelRanking = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const thresholdRanking =
    riskLevelRanking[policy.requireStepUpIfRiskLevelExceeds];

  if (riskLevelRanking[context.riskLevel] >= thresholdRanking) {
    requiresStepUp = true;
    triggeredRiskLevel = context.riskLevel;
    reasons.push(`High risk level: ${context.riskLevel}`);
  }

  // Check: Device not seen for too long
  if (
    context.isKnownDevice &&
    context.daysSinceLastSeen > policy.blockRefreshIfDeviceNotSeenFor
  ) {
    shouldBlock = true;
    reasons.push(
      `Device inactive for ${context.daysSinceLastSeen} days (max ${policy.blockRefreshIfDeviceNotSeenFor})`
    );
  }

  // Check: Too many active devices
  if (context.activeDeviceCount > policy.maxActiveDevicesPerUser) {
    // For multi-device sessions, this is just a warning
    if (!policy.allowMultiDeviceSession) {
      shouldBlock = true;
      reasons.push(
        `Too many active devices (${context.activeDeviceCount} > ${policy.maxActiveDevicesPerUser})`
      );
    }
  }

  // Check: Multi-device sessions not allowed
  if (!policy.allowMultiDeviceSession && context.activeDeviceCount > 1) {
    shouldBlock = true;
    reasons.push("Multiple device sessions not allowed by policy");
  }

  return {
    requiresStepUp,
    shouldBlock,
    reasons,
    triggeredRiskLevel,
  };
}

/**
 * Get recommended lease renewal deadline based on device binding policy.
 * 
 * This determines how often a token must be refreshed based on device trust.
 * Known devices can go longer without refresh, unknown devices need frequent refresh.
 */
export function getRecommendedRefreshInterval(
  context: DeviceBindingContext,
  policy: DevicePolicy = defaultDevicePolicy
): number {
  // Base lease: 7 days
  const baseLeaseDays = policy.allowRefreshWithinDaysOnSameDevice;

  // If new device: force refresh in 24 hours (requiring step-up)
  if (!context.isKnownDevice) {
    return 24 * 60 * 60 * 1000; // 24 hours in ms
  }

  // If high risk: force refresh within 1 day
  if (["HIGH", "CRITICAL"].includes(context.riskLevel)) {
    return 24 * 60 * 60 * 1000; // 24 hours in ms
  }

  // If medium risk: refresh within 3 days
  if (context.riskLevel === "MEDIUM") {
    return 3 * 24 * 60 * 60 * 1000; // 3 days in ms
  }

  // Known device, low risk: refresh within policy duration
  return baseLeaseDays * 24 * 60 * 60 * 1000;
}

/**
 * Check if step-up authentication should be shown to user.
 * 
 * Returns user-friendly message explaining why step-up is needed.
 */
export function getStepUpMessage(result: PolicyEvaluationResult): string {
  if (!result.requiresStepUp) {
    return "";
  }

  if (result.reasons.includes("New device detected")) {
    return "We detected a new device. Please verify your identity to continue.";
  }

  if (result.reasons.some((r) => r.includes("Device changed"))) {
    return "You're using a different device than before. Please verify your identity.";
  }

  if (result.reasons.some((r) => r.includes("High risk"))) {
    return "We detected unusual activity. Please verify your identity for security.";
  }

  return "Additional verification required. Please complete authentication.";
}

/**
 * Check if access should be completely denied.
 * 
 * Returns user-friendly error message explaining the block.
 */
export function getAccessDeniedMessage(result: PolicyEvaluationResult): string {
  if (!result.shouldBlock) {
    return "";
  }

  const inactivityReason = result.reasons.find((r) =>
    r.includes("Device inactive")
  );
  if (inactivityReason) {
    return `Your device hasn't been used recently. Please login again to continue. ${inactivityReason}`;
  }

  const multiDeviceReason = result.reasons.find((r) =>
    r.includes("Multiple device sessions")
  );
  if (multiDeviceReason) {
    return "You can only have one active session per your account security settings. Please logout from other devices first.";
  }

  return "Access denied for security reasons. Please contact support if you need assistance.";
}
