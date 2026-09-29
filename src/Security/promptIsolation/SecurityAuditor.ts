// chenpilot/src/Security/promptIsolation/SecurityAuditor.ts
import crypto from "crypto";
import logger from "../../config/logger";
import {
  scrubString,
  redactPayload,
  shannonEntropy,
} from "../../AuditLog/auditLog.redaction";
import { ContextProvenance, TrustLevel } from "../../Agents/context/TrustZone";

export enum SecurityEventType {
  PROMPT_INJECTION_DETECTED = "PROMPT_INJECTION_DETECTED",
  UNAUTHORIZED_TOOL_REJECTED = "UNAUTHORIZED_TOOL_REJECTED",
  DELIMITER_ESCAPE_ATTEMPT = "DELIMITER_ESCAPE_ATTEMPT",
  POLICY_VIOLATION_BLOCKED = "POLICY_VIOLATION_BLOCKED",
  CONTEXT_SIZE_EXCEEDED = "CONTEXT_SIZE_EXCEEDED",
}

export interface InjectionScanResult {
  isSuspicious: boolean;
  threatCategory?: string;
  matchedPatterns: string[];
  confidence: "low" | "medium" | "high";
}

export interface SecurityAuditEvent {
  eventType: SecurityEventType;
  provenance: ContextProvenance | string;
  trustLevel: TrustLevel | string;
  threatCategory?: string;
  payloadFingerprint: string;
  payloadSize: number;
  sanitizedSnippet: string;
  timestamp: string;
  traceId?: string;
  userId?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Injection detection rule definitions.
 */
interface InjectionRule {
  category: string;
  patterns: RegExp[];
  confidence: "low" | "medium" | "high";
}

const INJECTION_RULES: InjectionRule[] = [
  {
    category: "PROMPT_OVERRIDE",
    confidence: "high",
    patterns: [
      /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions|directives|rules)\b/i,
      /\bdisregard\s+(all\s+)?(previous|prior|above)\s+(instructions|directives|rules)\b/i,
      /\bforget\s+(all\s+)?(previous|prior)\s+(instructions|rules)\b/i,
      /\bsystem\s+(override|directive|prompt|instruction)\s*[:=]/i,
      /\bnew\s+system\s+(instruction|prompt|directive)\b/i,
      /\boverride\s+(all\s+)?(security|policy|restrictions)\b/i,
    ],
  },
  {
    category: "ROLEPLAY_JAILBREAK",
    confidence: "high",
    patterns: [
      /\byou\s+are\s+now\s+(in\s+)?(developer\s+mode|dan\s+mode|unrestricted\s+mode|admin\s+mode)\b/i,
      /\bact\s+as\s+(an\s+unrestricted|a\s+hacked|an\s+evil|dan)\b/i,
      /\bpretend\s+you\s+have\s+no\s+(rules|restrictions|filters)\b/i,
      /\b(dan|do\s+anything\s+now)\b/i,
      /\bimmerse\s+yourself\s+into\s+the\s+role\b/i,
      /\bjailbreak\b/i,
    ],
  },
  {
    category: "TOOL_AUTHORITY_HIJACK",
    confidence: "high",
    patterns: [
      /\b(?:execute|invoke|call|run)\s+(?:tool|action|function)\s*[:=]\s*["']?[a-zA-Z0-9_-]+/i,
      /\b(?:transfer|swap|withdraw|drain|approve)\s+(?:all\s+funds|all\s+balance|\d+\s*(?:xlm|usdc|eth|btc))\b/i,
      /\bgrant\s+(?:admin|root|superuser|moderator)\s+(?:role|access|privileges)\b/i,
      /\bforce\s+(?:execution|transfer|swap|payment)\b/i,
    ],
  },
  {
    category: "DELIMITER_ESCAPE",
    confidence: "high",
    patterns: [
      /<\/\s*untrusted_context_segment\s*>/i,
      /<\/\s*user_input\s*>/i,
      /<\/\s*system\s*>/i,
      /<\|im_start\|>|<\|im_end\|>/i,
      /\[\/?INST\]/i,
      /<\/\s*context\s*>/i,
    ],
  },
  {
    category: "POLICY_EVASION",
    confidence: "medium",
    patterns: [
      /\bbypass\s+(?:policy|risk\s+checks?|approval|verification)\b/i,
      /\bdisable\s+(?:security|safeguards|checks|monitoring)\b/i,
      /\bwithout\s+(?:user\s+)?(?:approval|confirmation|consent)\b/i,
    ],
  },
];

export class SecurityAuditor {
  private recentEvents: SecurityAuditEvent[] = [];
  private readonly MAX_EVENT_HISTORY = 200;

  /**
   * Scans a string payload for instruction-like injection patterns.
   */
  scanForInjections(content: string): InjectionScanResult {
    if (!content || typeof content !== "string") {
      return { isSuspicious: false, matchedPatterns: [], confidence: "low" };
    }

    const matchedPatterns: string[] = [];
    let detectedCategory: string | undefined;
    let highestConfidence: "low" | "medium" | "high" = "low";

    for (const rule of INJECTION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(content)) {
          matchedPatterns.push(pattern.source);
          if (!detectedCategory) {
            detectedCategory = rule.category;
            highestConfidence = rule.confidence;
          }
        }
      }
    }

    return {
      isSuspicious: matchedPatterns.length > 0,
      threatCategory: detectedCategory,
      matchedPatterns,
      confidence: highestConfidence,
    };
  }

  /**
   * Computes a cryptographic SHA-256 fingerprint for a payload.
   */
  computePayloadFingerprint(payload: string): string {
    return crypto
      .createHash("sha256")
      .update(payload ?? "")
      .digest("hex");
  }

  /**
   * Generates a safe, secret-free preview snippet from an untrusted payload.
   * Strips all API keys, private keys, JWTs, and high-entropy secrets.
   */
  createSafeSnippet(rawContent: string, maxChars = 120): string {
    if (!rawContent || typeof rawContent !== "string") return "";

    // 1. Take initial slice
    const slice = rawContent.slice(0, maxChars);

    // 2. Scrub patterns & high entropy strings
    let scrubbed = scrubString(slice);

    // 3. Double check for any residual high entropy substrings
    const words = scrubbed.split(/\s+/);
    const safeWords = words.map((word) => {
      if (word.length >= 24 && shannonEntropy(word) > 4.2) {
        return "[REDACTED:SECRET]";
      }
      return word;
    });

    scrubbed = safeWords.join(" ");

    // 4. Final length bounding
    if (rawContent.length > maxChars) {
      scrubbed += "...";
    }

    return scrubbed;
  }

  /**
   * Records and logs a structured security event, strictly ensuring no raw secrets are stored.
   */
  logSecurityEvent(params: {
    eventType: SecurityEventType;
    provenance: ContextProvenance | string;
    trustLevel: TrustLevel | string;
    rawPayload: string;
    threatCategory?: string;
    traceId?: string;
    userId?: string;
    action?: string;
    metadata?: Record<string, unknown>;
  }): SecurityAuditEvent {
    const {
      eventType,
      provenance,
      trustLevel,
      rawPayload,
      threatCategory,
      traceId,
      userId,
      action,
      metadata,
    } = params;

    const payloadFingerprint = this.computePayloadFingerprint(rawPayload);
    const sanitizedSnippet = this.createSafeSnippet(rawPayload);
    const sanitizedMetadata = metadata
      ? (redactPayload(metadata) as Record<string, unknown>)
      : undefined;

    const event: SecurityAuditEvent = {
      eventType,
      provenance,
      trustLevel,
      threatCategory,
      payloadFingerprint,
      payloadSize: rawPayload.length,
      sanitizedSnippet,
      timestamp: new Date().toISOString(),
      traceId,
      userId,
      action,
      metadata: sanitizedMetadata,
    };

    // Store in history
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.MAX_EVENT_HISTORY) {
      this.recentEvents.shift();
    }

    // Log structured security warning (never contains raw payload or secrets)
    logger.warn("Security Event: " + eventType, {
      eventType,
      provenance,
      trustLevel,
      threatCategory,
      payloadFingerprint,
      payloadSize: event.payloadSize,
      sanitizedSnippet,
      traceId,
      userId,
      action,
    });

    return event;
  }

  /**
   * Returns recent security events for diagnostics / testing.
   */
  getRecentEvents(): SecurityAuditEvent[] {
    return [...this.recentEvents];
  }

  /**
   * Clears recent security events.
   */
  clearEvents(): void {
    this.recentEvents = [];
  }
}

export const securityAuditor = new SecurityAuditor();
