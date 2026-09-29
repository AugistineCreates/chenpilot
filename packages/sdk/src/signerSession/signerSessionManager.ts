/**
 * Signer session lifecycle manager.
 *
 * Tracks connect, reconnect, staleness, revocation and capability downgrade
 * for any provider that satisfies {@link SessionCapableProvider} — hardware,
 * browser extension or mock. All time-dependent behaviour goes through an
 * injectable clock so the lifecycle is deterministically testable rather than
 * dependent on real timers.
 */

import type { SignatureProviderCapabilities } from "../signature-providers/types";
import {
  SignerSessionRevocationReason,
  SignerSessionStatus,
  SignerSessionTransport,
  type CapabilityDowngrade,
  type OpenSessionOptions,
  type SessionCapableProvider,
  type SignerSession,
  type SignerSessionListener,
  type SignerSessionPolicy,
  type SignerSessionTransition,
} from "./types";

/** Policy applied when neither the manager nor the caller specifies one. */
export const DEFAULT_SESSION_POLICY: SignerSessionPolicy = {
  idleTimeoutMs: 5 * 60_000,
  maxLifetimeMs: 60 * 60_000,
  maxReconnectAttempts: 3,
  allowCapabilityDowngrade: true,
};

/**
 * Transport-specific defaults.
 *
 * Hardware devices lock or get unplugged, so they go stale quickly and are
 * given more reconnect attempts. Browser extensions survive longer but a
 * capability downgrade there usually means the user switched accounts, which
 * is treated as a security event rather than a tolerable regression.
 */
export const TRANSPORT_SESSION_POLICIES: Record<
  SignerSessionTransport,
  Partial<SignerSessionPolicy>
> = {
  [SignerSessionTransport.HARDWARE]: {
    idleTimeoutMs: 2 * 60_000,
    maxReconnectAttempts: 5,
  },
  [SignerSessionTransport.BROWSER]: {
    idleTimeoutMs: 10 * 60_000,
    allowCapabilityDowngrade: false,
  },
  [SignerSessionTransport.MOCK]: {
    idleTimeoutMs: 60_000,
    maxLifetimeMs: 5 * 60_000,
  },
  [SignerSessionTransport.REMOTE]: {},
};

/** Infer a transport from a provider id, defaulting to `REMOTE`. */
export function inferTransport(providerId: string): SignerSessionTransport {
  const id = providerId.toLowerCase();
  if (id.includes("ledger") || id.includes("trezor")) {
    return SignerSessionTransport.HARDWARE;
  }
  if (id.includes("albedo") || id.includes("freighter") || id.includes("xbull")) {
    return SignerSessionTransport.BROWSER;
  }
  if (id.includes("mock") || id.includes("test")) {
    return SignerSessionTransport.MOCK;
  }
  return SignerSessionTransport.REMOTE;
}

/**
 * Compare two capability snapshots and report every regression.
 *
 * A regression is a boolean going `true → false`, a numeric limit decreasing,
 * or an entry disappearing from a list such as `supportedChains`.
 */
export function diffCapabilities(
  previous: SignatureProviderCapabilities | undefined,
  current: SignatureProviderCapabilities | undefined,
  detectedAt: number
): CapabilityDowngrade[] {
  if (!previous || !current) return [];

  const downgrades: CapabilityDowngrade[] = [];
  const record = (capability: string, before: unknown, after: unknown): void => {
    downgrades.push({ capability, previous: before, current: after, detectedAt });
  };

  const booleanKeys = [
    "supportsMultipleAccounts",
    "supportsMessageSigning",
    "supportsSubmission",
    "supportsHealthCheck",
  ] as const;

  booleanKeys.forEach((key) => {
    if (previous[key] === true && current[key] !== true) {
      record(key, previous[key], current[key]);
    }
  });

  if (
    typeof previous.maxConcurrentSignatures === "number" &&
    typeof current.maxConcurrentSignatures === "number" &&
    current.maxConcurrentSignatures < previous.maxConcurrentSignatures
  ) {
    record(
      "maxConcurrentSignatures",
      previous.maxConcurrentSignatures,
      current.maxConcurrentSignatures
    );
  }

  const listKeys = ["supportedChains", "signingModes"] as const;
  listKeys.forEach((key) => {
    const before = previous[key];
    const after = current[key];
    if (!Array.isArray(before)) return;
    const remaining = new Set((Array.isArray(after) ? after : []) as unknown[]);
    const lost = before.filter((entry) => !remaining.has(entry));
    if (lost.length > 0) record(key, before, after ?? []);
  });

  return downgrades;
}

let sessionCounter = 0;

function defaultIdFactory(): string {
  sessionCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `sess_${Date.now().toString(36)}_${sessionCounter}_${random}`;
}

/** Construction options for {@link SignerSessionManager}. */
export interface SignerSessionManagerOptions {
  /** Defaults merged under transport defaults and per-session overrides. */
  policy?: Partial<SignerSessionPolicy>;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
  /** Injectable id generator, useful for deterministic tests. */
  idFactory?: () => string;
}

/**
 * Tracks the lifecycle of signer sessions across providers.
 *
 * @example
 * ```ts
 * const manager = new SignerSessionManager();
 * const session = await manager.open(ledgerProvider);
 * // ...later
 * if (manager.evaluate(session.id).status === SignerSessionStatus.STALE) {
 *   await manager.reconnect(session.id, ledgerProvider);
 * }
 * ```
 */
export class SignerSessionManager {
  private readonly sessions = new Map<string, SignerSession>();
  private readonly policies = new Map<string, SignerSessionPolicy>();
  private readonly listeners: SignerSessionListener[] = [];
  private readonly basePolicy: Partial<SignerSessionPolicy>;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options: SignerSessionManagerOptions = {}) {
    this.basePolicy = options.policy ?? {};
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  /** Subscribe to lifecycle transitions. Returns an unsubscribe function. */
  onTransition(listener: SignerSessionListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  /** Resolved policy for a session. */
  policyFor(sessionId: string): SignerSessionPolicy {
    const policy = this.policies.get(sessionId);
    if (!policy) throw new Error(`Unknown session: ${sessionId}`);
    return policy;
  }

  /** All tracked sessions, in insertion order. */
  list(): SignerSession[] {
    return [...this.sessions.values()];
  }

  /** Look up a session, or `undefined` when it is not tracked. */
  get(sessionId: string): SignerSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Open a session against `provider`, connecting it if necessary.
   *
   * The capability snapshot taken here becomes the baseline that later
   * reconnects are compared against.
   */
  async open(
    provider: SessionCapableProvider,
    options: OpenSessionOptions = {}
  ): Promise<SignerSession> {
    const at = this.now();
    const transport = options.transport ?? inferTransport(provider.providerId);
    const policy: SignerSessionPolicy = {
      ...DEFAULT_SESSION_POLICY,
      ...TRANSPORT_SESSION_POLICIES[transport],
      ...this.basePolicy,
      ...(options.policy ?? {}),
    };

    const session: SignerSession = {
      id: options.sessionId ?? this.idFactory(),
      providerId: provider.providerId,
      transport,
      status: SignerSessionStatus.CONNECTING,
      createdAt: at,
      lastActivityAt: at,
      downgrades: [],
      reconnectAttempts: 0,
      history: [],
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };

    this.sessions.set(session.id, session);
    this.policies.set(session.id, policy);
    this.record(session, SignerSessionStatus.DISCONNECTED, SignerSessionStatus.CONNECTING, at, "open");

    try {
      const connection = await provider.connect();
      if (!connection?.isConnected) {
        throw new Error("Provider reported an unsuccessful connection");
      }
      const capabilities = provider.getCapabilities();
      const connectedAt = this.now();

      session.connectionId = connection.connectionId;
      session.baselineCapabilities = capabilities;
      session.currentCapabilities = capabilities;
      session.lastActivityAt = connectedAt;
      this.transition(session, SignerSessionStatus.ACTIVE, connectedAt, "connected");
      return session;
    } catch (caught) {
      const failedAt = this.now();
      session.lastError = caught instanceof Error ? caught.message : String(caught);
      this.transition(session, SignerSessionStatus.ERROR, failedAt, session.lastError);
      throw caught;
    }
  }

  /**
   * Mark a session as used, clearing staleness.
   *
   * Expired and revoked sessions cannot be revived this way.
   */
  touch(sessionId: string): SignerSession {
    const session = this.require(sessionId);
    const at = this.now();

    if (
      session.status === SignerSessionStatus.REVOKED ||
      session.status === SignerSessionStatus.EXPIRED
    ) {
      return session;
    }

    session.lastActivityAt = at;
    if (session.status === SignerSessionStatus.STALE) {
      this.transition(session, SignerSessionStatus.ACTIVE, at, "activity");
    }
    return this.evaluate(sessionId);
  }

  /**
   * Recompute a session's status against its policy.
   *
   * Expiry is checked before staleness because an expired session must be
   * reopened, not reconnected.
   */
  evaluate(sessionId: string): SignerSession {
    const session = this.require(sessionId);
    const policy = this.policyFor(sessionId);
    const at = this.now();

    const terminal =
      session.status === SignerSessionStatus.REVOKED ||
      session.status === SignerSessionStatus.EXPIRED ||
      session.status === SignerSessionStatus.ERROR ||
      session.status === SignerSessionStatus.DISCONNECTED ||
      session.status === SignerSessionStatus.CONNECTING;
    if (terminal) return session;

    if (at - session.createdAt >= policy.maxLifetimeMs) {
      this.transition(session, SignerSessionStatus.EXPIRED, at, "max lifetime reached");
      return session;
    }

    if (
      session.status === SignerSessionStatus.ACTIVE &&
      at - session.lastActivityAt >= policy.idleTimeoutMs
    ) {
      this.transition(session, SignerSessionStatus.STALE, at, "idle timeout reached");
    }

    return session;
  }

  /** True when the session is `ACTIVE` after re-evaluation. */
  isUsable(sessionId: string): boolean {
    return this.evaluate(sessionId).status === SignerSessionStatus.ACTIVE;
  }

  /**
   * Reconnect a stale or errored session and diff the capabilities the
   * provider comes back with.
   *
   * When capabilities regress and the policy forbids downgrades, the session
   * is revoked instead of restored.
   *
   * @throws {Error} when the session is expired, revoked, or has exhausted
   * its reconnect budget.
   */
  async reconnect(
    sessionId: string,
    provider: SessionCapableProvider
  ): Promise<SignerSession> {
    const session = this.require(sessionId);
    const policy = this.policyFor(sessionId);

    if (session.status === SignerSessionStatus.REVOKED) {
      throw new Error(`Session ${sessionId} was revoked and cannot be reconnected`);
    }
    if (session.status === SignerSessionStatus.EXPIRED) {
      throw new Error(`Session ${sessionId} expired and must be reopened`);
    }
    if (session.reconnectAttempts >= policy.maxReconnectAttempts) {
      throw new Error(
        `Session ${sessionId} exhausted its ${policy.maxReconnectAttempts} reconnect attempts`
      );
    }

    session.reconnectAttempts += 1;
    this.transition(session, SignerSessionStatus.CONNECTING, this.now(), "reconnect");

    try {
      if (provider.isConnected()) {
        await provider.disconnect();
      }
      const connection = await provider.connect();
      if (!connection?.isConnected) {
        throw new Error("Provider reported an unsuccessful reconnection");
      }

      const at = this.now();
      const capabilities = provider.getCapabilities();
      const downgrades = diffCapabilities(
        session.baselineCapabilities,
        capabilities,
        at
      );

      session.connectionId = connection.connectionId;
      session.currentCapabilities = capabilities;
      session.lastActivityAt = at;

      if (downgrades.length > 0) {
        session.downgrades.push(...downgrades);
        if (!policy.allowCapabilityDowngrade) {
          return this.revoke(
            sessionId,
            SignerSessionRevocationReason.POLICY_VIOLATION,
            `Capability downgrade is not permitted for ${session.transport} sessions`
          );
        }
      }

      this.transition(
        session,
        SignerSessionStatus.ACTIVE,
        at,
        downgrades.length > 0 ? "reconnected with capability downgrade" : "reconnected"
      );
      return session;
    } catch (caught) {
      const at = this.now();
      session.lastError = caught instanceof Error ? caught.message : String(caught);
      this.transition(session, SignerSessionStatus.ERROR, at, session.lastError);
      throw caught;
    }
  }

  /** Revoke a session. Revocation is terminal. */
  revoke(
    sessionId: string,
    reason: SignerSessionRevocationReason = SignerSessionRevocationReason.USER_REQUESTED,
    detail?: string
  ): SignerSession {
    const session = this.require(sessionId);
    if (session.status === SignerSessionStatus.REVOKED) return session;

    session.revocationReason = reason;
    this.transition(session, SignerSessionStatus.REVOKED, this.now(), detail ?? reason);
    return session;
  }

  /**
   * Close a session cleanly, disconnecting the provider when one is supplied.
   *
   * Unlike {@link revoke} this is not a security event, and the session ends
   * in `DISCONNECTED`.
   */
  async close(
    sessionId: string,
    provider?: SessionCapableProvider
  ): Promise<SignerSession> {
    const session = this.require(sessionId);
    if (provider && provider.isConnected()) {
      await provider.disconnect();
    }
    session.connectionId = undefined;
    if (session.status !== SignerSessionStatus.REVOKED) {
      this.transition(session, SignerSessionStatus.DISCONNECTED, this.now(), "closed");
    }
    return session;
  }

  /** Re-evaluate every session, returning those that are no longer usable. */
  sweep(): SignerSession[] {
    return this.list()
      .map((session) => this.evaluate(session.id))
      .filter((session) => session.status !== SignerSessionStatus.ACTIVE);
  }

  /** Forget terminal sessions so the manager does not grow without bound. */
  prune(): number {
    let removed = 0;
    for (const session of this.list()) {
      const terminal =
        session.status === SignerSessionStatus.REVOKED ||
        session.status === SignerSessionStatus.EXPIRED ||
        session.status === SignerSessionStatus.DISCONNECTED;
      if (terminal) {
        this.sessions.delete(session.id);
        this.policies.delete(session.id);
        removed += 1;
      }
    }
    return removed;
  }

  private require(sessionId: string): SignerSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return session;
  }

  private transition(
    session: SignerSession,
    to: SignerSessionStatus,
    at: number,
    reason?: string
  ): void {
    const from = session.status;
    if (from === to) return;
    session.status = to;
    this.record(session, from, to, at, reason);
  }

  private record(
    session: SignerSession,
    from: SignerSessionStatus,
    to: SignerSessionStatus,
    at: number,
    reason?: string
  ): void {
    const transition: SignerSessionTransition = {
      from,
      to,
      at,
      ...(reason ? { reason } : {}),
    };
    session.history.push(transition);
    this.listeners.forEach((listener) => {
      try {
        listener(session, transition);
      } catch {
        // Listener failures must not break the lifecycle.
      }
    });
  }
}
