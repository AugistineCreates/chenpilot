import { ipBlacklistService } from "../ipBlacklist.service";
import { AbusePolicy } from "./types";

export const defaultAbusePolicy: AbusePolicy = {
  rules: [
    {
      id: "blocked-ip",
      description: "Deny traffic from active IP blacklist entries.",
      surfaces: ["api", "bot", "realtime"],
      actions: ["*"],
      decision: "deny",
      reason: "IP address is blocked",
      match: async ({ subject }) => {
        if (!subject.ipAddress) {
          return false;
        }

        return ipBlacklistService.isBlacklisted(subject.ipAddress);
      },
    },
  ],
  rateLimits: [
    {
      id: "api-sensitive-action",
      surfaces: ["api"],
      actions: ["query", "wallet", "soroban", "kyc.submit"],
      maxRequests: 20,
      windowMs: 60 * 1000,
      keyBy: ["userId", "ipAddress"],
    },
    {
      id: "bot-command",
      surfaces: ["bot"],
      actions: ["*"],
      maxRequests: 10,
      windowMs: 60 * 1000,
      keyBy: ["userId"],
    },
    {
      id: "realtime-subscribe",
      surfaces: ["realtime"],
      actions: ["subscribe:transactions", "subscribe:bot-alerts"],
      maxRequests: 30,
      windowMs: 60 * 1000,
      keyBy: ["userId", "sessionId", "ipAddress"],
    },
  ],
};
