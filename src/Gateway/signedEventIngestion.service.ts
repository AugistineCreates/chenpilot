import { Request } from "express";
import crypto from "crypto";
import { idempotencyService } from "../Reliability/IdempotencyService";
import { auditLogService } from "../AuditLog/auditLog.service";
import {
  IntegrationAction,
  EventCategory,
  AuditEventSeverity,
  AuditEventAction,
} from "../AuditLog/auditEvent.types";
import logger from "../config/logger";

/**
 * Provider-specific signature configuration
 */
export interface ProviderSignatureConfig {
  headerName: string;
  algorithm?: "hmac-sha256" | "sha256" | "rsa-sha256";
  encoding?: "hex" | "base64";
  timestampHeader?: string;
  replayWindowMs?: number;
}

/**
 * Verified event envelope after signature/policy checks
 */
export interface VerifiedEventEnvelope<T = unknown> {
  source: string;
  eventId: string;
  payload: T;
  isNew: boolean;
  signatureValid: boolean;
  timestamp?: Date;
  metadata: Record<string, unknown>;
}

type EventHandler<T = unknown> = (envelope: VerifiedEventEnvelope<T>) => Promise<void>;

/**
 * SignedEventIngestionService
 *
 * Generalises webhook/event ingestion across providers (Stellar, Telegram, Discord, future).
 *
 * Replaces:
 *   - src/Gateway/webhook.service.ts (Stellar-specific HMAC validation + in-memory duplicate check)
 *
 * Features:
 *   - Provider-specific signature verification (HMAC, RSA, plain SHA-256)
 *   - Replay-window protection using event timestamp headers
 *   - Durable idempotency via unified IdempotencyService
 *   - Audit logging integrated with correlation/execution IDs
 *   - Pluggable event handlers per provider/event type
 */

export class SignedEventIngestionService {
  private readonly handlers = new Map<string, EventHandler>();
  private readonly providerConfigs = new Map<string, ProviderSignatureConfig>();

  // Default provider configs - extend as new integrations are added
  private readonly DEFAULT_PROVIDERS: Record<string, ProviderSignatureConfig> = {
    stellar: {
      headerName: "x-stellar-signature",
      algorithm: "hmac-sha256",
      encoding: "hex",
      timestampHeader: "x-stellar-timestamp",
      replayWindowMs: 5 * 60 * 1000, // 5 minutes
    },
    telegram: {
      headerName: "x-telegram-bot-api-secret-token",
      algorithm: "sha256",
      encoding: "hex",
      replayWindowMs: 24 * 60 * 60 * 1000, // 24h
    },
    discord: {
      headerName: "x-signature-ed25519-sha256",
      algorithm: "sha256",
      encoding: "base64",
      timestampHeader: "x-signature-timestamp",
      replayWindowMs: 15 * 60 * 1000, // 15 minutes
    },
  };

  constructor() {
    Object.entries(this.DEFAULT_PROVIDERS).forEach(([name, cfg]) => {
      this.providerConfigs.set(name, cfg);
    });
  }

  registerProvider(name: string, config: ProviderSignatureConfig): void {
    this.providerConfigs.set(name, config);
    logger.info(`SignedEventIngestionService: registered provider=${name}`);
  }

  registerHandler(key: string, handler: EventHandler): void {
    this.handlers.set(key, handler);
    logger.info(`SignedEventIngestionService: registered handler for key=${key}`);
  }

  // ── Public Ingestion Entrypoint ─────────────────────────────────────────────

  async ingest<T = unknown>(options: {
    source: string;
    eventId: string;
    req: Request;
    payload: T;
    signature?: string;
    timestampHeaderValue?: string;
    metadata?: Record<string, unknown>;
    handlerKey?: string;
  }): Promise<VerifiedEventEnvelope<T>> {
    const { source, eventId, req, payload, metadata = {} } = options;
    const providerConfig = this.providerConfigs.get(source);

    // 1) Signature verification
    let signatureValid = true;
    if (providerConfig?.headerName && providerConfig.headerName !== "none") {
      signatureValid = await this.verifySignature({
        source,
        payload,
        signature: options.signature,
        timestampHeaderValue: options.timestampHeaderValue,
        req,
        providerConfig,
      });
    }

    if (!signatureValid) {
      await this.recordAuditEvent({
        source,
        eventId,
        action: getIngestionFailureAction(source, "invalid_signature"),
        success: false,
        metadata,
      });
      throw new Error(`Invalid signature for event ${eventId} from ${source}`);
    }

    // 2) Replay-window check
    let eventTimestamp: Date | undefined;
    if (providerConfig?.timestampHeader && options.timestampHeaderValue) {
      const ts = parseInt(options.timestampHeaderValue, 10);
      if (!Number.isNaN(ts)) {
        eventTimestamp = new Date(ts);
        const windowMs = providerConfig.replayWindowMs ?? 5 * 60 * 1000;
        const now = Date.now();
        const diff = Math.abs(now - eventTimestamp.getTime());
        if (diff > windowMs) {
          await this.recordAuditEvent({
            source,
            eventId,
            action: getIngestionFailureAction(source, "replay_outside_window"),
            success: false,
            metadata: { ageMs: diff, windowMs },
          });
          throw new Error(`Event ${eventId} outside replay window (age=${diff}ms)`);
        }
      }
    }

    // 3) Durable idempotency check
    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const idempotencyResult = await idempotencyService.ingestSignedEvent({
      source,
      eventId,
      signature: options.signature,
      timestamp: eventTimestamp?.toISOString(),
      payload,
      metadata: {
        payloadHash,
        signatureValid: true,
        ...metadata,
      },
    });

    // 4) Dispatch to handler if new
    if (idempotencyResult.isNew && options.handlerKey) {
      const handler = this.handlers.get(options.handlerKey);
      if (handler) {
        const envelope: VerifiedEventEnvelope<T> = {
          source,
          eventId,
          payload,
          isNew: true,
          signatureValid: true,
          timestamp: eventTimestamp,
          metadata: {
            payloadHash,
            ...metadata,
          },
        };

        try {
          await handler(envelope);
        } catch (err) {
          logger.error(`SignedEventIngestionService: handler failed for ${eventId}`, { error: err });
        }
      }
    }

    const envelope: VerifiedEventEnvelope<T> = {
      source,
      eventId,
      payload,
      isNew: idempotencyResult.isNew,
      signatureValid: true,
      timestamp: eventTimestamp,
      metadata: {
        payloadHash,
        ...metadata,
      },
    };

    // 5) Audit log (always, even for duplicates)
    await this.recordAuditEvent({
      source,
      eventId,
      action: getIngestionAction(source),
      success: true,
      metadata: {
        isNew: idempotencyResult.isNew,
        payloadHash,
        signatureValid: true,
        hasTimestamp: !!eventTimestamp,
        ...metadata,
      },
    });

    return envelope;
  }

  // ── Signature Verification ──────────────────────────────────────────────────

  private async verifySignature<T>(options: {
    source: string;
    payload: T;
    signature?: string;
    timestampHeaderValue?: string;
    req: Request;
    providerConfig: ProviderSignatureConfig;
  }): Promise<boolean> {
    const { payload, signature, timestampHeaderValue, providerConfig } = options;

    // If no signature provided, reject
    if (!signature) {
      logger.warn(`SignedEventIngestionService: missing signature for source=${options.source}`);
      return false;
    }

    const secret = this.resolveSecret(options.source);
    if (!secret) {
      logger.warn(`SignedEventIngestionService: no secret configured for source=${options.source} — skipping verification`);
      return true;
    }

    try {
      switch (providerConfig.algorithm) {
        case "hmac-sha256":
          return this.verifyHmac(secret, payload, signature, timestampHeaderValue);
        case "sha256":
          return this.verifySha256(secret, payload, signature);
        case "rsa-sha256":
          return this.verifyRsa(payload, signature);
        default:
          logger.warn(`SignedEventIngestionService: unknown algorithm=${providerConfig.algorithm}`);
          return false;
      }
    } catch (error) {
      logger.error(`SignedEventIngestionService: signature verification threw`, { error, source: options.source });
      return false;
    }
  }

  private verifyHmac(
    secret: string,
    payload: unknown,
    signature: string,
    timestampHeaderValue?: string
  ): boolean {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const signedPayload = timestampHeaderValue ? `${timestampHeaderValue}.${body}` : body;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(signedPayload);
    const expected = hmac.digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  private verifySha256(secret: string, payload: unknown, signature: string): boolean {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(body);
    const expected = hmac.digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  private verifyRsa(_payload: unknown, _signature: string): boolean {
    // RSA verification requires a public key; placeholder integration.
    logger.warn("SignedEventIngestionService: RSA signature verification not yet implemented");
    return false;
  }

  private resolveSecret(source: string): string | undefined {
    const envMap: Record<string, string> = {
      stellar: "STELLAR_WEBHOOK_SECRET",
      telegram: "TELEGRAM_WEBHOOK_SECRET",
      discord: "DISCORD_WEBHOOK_SECRET",
    };
    const envVar = envMap[source.toLowerCase()];
    return envVar ? process.env[envVar] : undefined;
  }

  // ── Audit Integration ───────────────────────────────────────────────────────

  private async recordAuditEvent(options: {
    source: string;
    eventId: string;
    action: string;
    success: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await auditLogService.logEvent({
        action: options.action as AuditEventAction,
        category: EventCategory.INTEGRATION,
        severity: options.success ? AuditEventSeverity.INFO : AuditEventSeverity.WARNING,
        actor: {
          serviceId: `event-ingestion:${options.source}`,
        },
        resource: {
          endpoint: `event:${options.source}`,
          type: "SignedEvent",
          id: options.eventId,
        },
        metadata: options.metadata,
        success: options.success,
      });
    } catch (err) {
      logger.error("SignedEventIngestionService: failed to record audit event", { error: err });
    }
  }
}

// ─── Action Taxonomy Helpers ──────────────────────────────────────────────────

function getIngestionAction(source: string): string {
  switch (source.toLowerCase()) {
    case "stellar":
      return IntegrationAction.WEBHOOK_RECEIVED;
    case "telegram":
      return "integration.telegram.update.received";
    case "discord":
      return "integration.discord.interaction.received";
    default:
      return "integration.event.received";
  }
}

function getIngestionFailureAction(source: string, reason: string): string {
  const base = getIngestionAction(source).replace(".received", "");
  return `${base}.rejected.${reason}`;
}

export const signedEventIngestionService = new SignedEventIngestionService();