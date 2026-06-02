import { AbusePreventionService } from "./AbusePreventionService";
import { defaultAbusePolicy } from "./defaultPolicy";

export const defaultAbusePreventionService = new AbusePreventionService(
  defaultAbusePolicy
);
