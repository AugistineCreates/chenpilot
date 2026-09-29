/**
 * Types for the signer session lifecycle model.
 *
 * `SignatureProvider` exposes `connect()`, `disconnect()` and `isConnected()`,
 * which is enough to answer "is a socket open right now" but not enough to
 * answer the questions long-lived applications actually ask: has this session
 * gone stale, was it revoked, did the device come back with fewer capabilities
 * than it had before? These types model that lifecycle explicitly and
 * identically for hardware, browser-extension and mock providers.
 */

import type {
  SignatureProviderAccount,
  SignatureProviderCapabilities,
} from "../signature-providers/types";

/** Where the signer physically lives, which drives the default policy. */
export enum SignerSessionTransport {
  /** USB/Bluetooth hardware devices such as Ledger. */
  HARDWARE = "hardware",
  /** Browser extensions and web wallets such as Albedo or Freighter. */
  BROWSER = "browser",
  /** In-process test doubles. */
  MOCK = "mock",
  /** Anything that does not fit the categories above. */
  REMOTE = "remote",
}

/** Lifecycle states a session can occupy. */
export enum SignerSessionStatus {
  /** Created but not yet connected, or cleanly closed. */
  DISCONNECTED = "disconnected",
  /** A connect or reconnect attempt is in flight. */
  CONNECTING = "connecting",
  /** Connected and within all policy limits. */
  ACTIVE = "active",
  /** Idle beyond the policy threshold; needs revalidation before signing. */
  STALE = "stale",
  /** Past its absolute lifetime; must be reopened, not reconnected. */
  EXPIRED = "expired",
  /** Withdrawn by the user, the provider or the host application. */
  REVOKED = "revoked",
  /** A connect or reconnect attempt failed terminally. */
  ERROR = "error",
}

/** Why a session was revoked. */
export enum SignerSessionRevocationReason {
  USER_REQUESTED = "user_requested",
  PROVIDER_DISCONNECTED = "provider_disconnected",
  ACCOUNT_CHANGED = "account_changed",
  POLICY_VIOLATION = "policy_violation",
  SECURITY = "security",
}

/** Thresholds that govern staleness, expiry and reconnection. */
export interface SignerSessionPolicy {
  /** Inactivity after which a session becomes {@link SignerSessionStatus.STALE}. */
  idleTimeoutMs: number;
  /** Absolute age after which a session becomes {@link SignerSessionStatus.EXPIRED}. */
  maxLifetimeMs: number;
  /** Reconnect attempts allowed before the session moves to `ERROR`. */
  maxReconnectAttempts: number;
  /**
   * Whether losing capabilities on reconnect is tolerated. When `false` the
   * session is revoked instead of downgraded.
   */
  allowCapabilityDowngrade: boolean;
}

/** A capability that was present before a reconnect and absent afterwards. */
export interface CapabilityDowngrade {
  /** Capability field that regressed, e.g. `supportsMessageSigning`. */
  capability: string;
  /** Value observed when the session was opened. */
  previous: unknown;
  /** Value observed after reconnecting. */
  current: unknown;
  /** When the regression was detected. */
  detectedAt: number;
}

/** An observed lifecycle transition, retained for auditing. */
export interface SignerSessionTransition {
  from: SignerSessionStatus;
  to: SignerSessionStatus;
  at: number;
  reason?: string;
}

/** The full state of a signer session. */
export interface SignerSession {
  id: string;
  providerId: string;
  transport: SignerSessionTransport;
  status: SignerSessionStatus;
  /** Connection identifier reported by the provider, when connected. */
  connectionId?: string;
  createdAt: number;
  /** Last time the session was used or explicitly touched. */
  lastActivityAt: number;
  /** Capabilities recorded when the session was first opened. */
  baselineCapabilities?: SignatureProviderCapabilities;
  /** Capabilities most recently reported by the provider. */
  currentCapabilities?: SignatureProviderCapabilities;
  /** Capabilities lost across reconnects, newest last. */
  downgrades: CapabilityDowngrade[];
  /** Accounts reported by the provider, when known. */
  accounts?: SignatureProviderAccount[];
  reconnectAttempts: number;
  revocationReason?: SignerSessionRevocationReason;
  /** Message from the failure that moved the session to `ERROR`. */
  lastError?: string;
  history: SignerSessionTransition[];
  metadata?: Record<string, unknown>;
}

/**
 * Minimal provider surface the session manager depends on.
 *
 * Structurally satisfied by `SignatureProvider`, so the mock, Ledger and
 * Albedo providers all work without adapters, and tests can supply a plain
 * object.
 */
export interface SessionCapableProvider {
  readonly providerId: string;
  connect(): Promise<{ isConnected: boolean; connectionId: string }>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getCapabilities(): SignatureProviderCapabilities;
}

/** Options accepted when opening a session. */
export interface OpenSessionOptions {
  /** Overrides the transport inferred from the provider id. */
  transport?: SignerSessionTransport;
  /** Per-session policy overrides merged onto the manager defaults. */
  policy?: Partial<SignerSessionPolicy>;
  /** Free-form annotations stored on the session. */
  metadata?: Record<string, unknown>;
  /** Explicit session id; generated when omitted. */
  sessionId?: string;
}

/** Callback invoked on every lifecycle transition. */
export type SignerSessionListener = (
  session: SignerSession,
  transition: SignerSessionTransition
) => void;
