import { AbusePreventionService } from "./AbusePreventionService";
import { defaultAbusePreventionService } from "./serviceInstance";
import { AbuseEvaluationResult, AbuseRequestContext } from "./types";

export async function evaluateBotAbusePolicy(
  action: string,
  subject: AbuseRequestContext["subject"],
  metadata?: Record<string, unknown>,
  service: AbusePreventionService = defaultAbusePreventionService
): Promise<AbuseEvaluationResult> {
  return service.evaluate({
    surface: "bot",
    action,
    subject,
    metadata,
  });
}

export async function evaluateRealtimeAbusePolicy(
  action: string,
  subject: AbuseRequestContext["subject"],
  metadata?: Record<string, unknown>,
  service: AbusePreventionService = defaultAbusePreventionService
): Promise<AbuseEvaluationResult> {
  return service.evaluate({
    surface: "realtime",
    action,
    subject,
    metadata,
  });
}
