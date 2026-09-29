/**
 * Tests for the signer session lifecycle — Issue #569
 */

import type { SignatureProviderCapabilities } from "../signature-providers/types";
import {
  DEFAULT_SESSION_POLICY,
  SignerSessionManager,
  SignerSessionRevocationReason,
  SignerSessionStatus,
  SignerSessionTransport,
  diffCapabilities,
  inferTransport,
  type SessionCapableProvider,
} from "../signerSession";

const BASE_CAPABILITIES: SignatureProviderCapabilities = {
  supportedChains: ["stellar" as never],
  supportsMultipleAccounts: true,
  requiresUserInteraction: false,
  supportsMessageSigning: true,
  maxConcurrentSignatures: 5,
  signingModes: ["transaction", "message"],
};

/**
 * Controllable clock. Every time-dependent assertion advances this rather
 * than waiting, so the suite is deterministic and instant.
 */
class Clock {
  constructor(private value = 1_000) {}
  now = (): number => this.value;
  advance(ms: number): void {
    this.value += ms;
  }
}

class FakeProvider implements SessionCapableProvider {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  failNextConnect = false;
  reportUnsuccessful = false;

  constructor(
    readonly providerId = "mock-provider",
    private capabilities: SignatureProviderCapabilities = BASE_CAPABILITIES
  ) {}

  async connect(): Promise<{ isConnected: boolean; connectionId: string }> {
    this.connectCalls += 1;
    if (this.failNextConnect) {
      this.failNextConnect = false;
      throw new Error("device unavailable");
    }
    if (this.reportUnsuccessful) {
      return { isConnected: false, connectionId: "" };
    }
    this.connected = true;
    return { isConnected: true, connectionId: `conn-${this.connectCalls}` };
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getCapabilities(): SignatureProviderCapabilities {
    return this.capabilities;
  }

  setCapabilities(capabilities: SignatureProviderCapabilities): void {
    this.capabilities = capabilities;
  }
}

function setup(policy?: Partial<typeof DEFAULT_SESSION_POLICY>) {
  const clock = new Clock();
  let counter = 0;
  const manager = new SignerSessionManager({
    now: clock.now,
    idFactory: () => `sess-${++counter}`,
    ...(policy ? { policy } : {}),
  });
  return { clock, manager };
}

describe("inferTransport", () => {
  it("classifies known provider families", () => {
    expect(inferTransport("ledger-nano-s")).toBe(SignerSessionTransport.HARDWARE);
    expect(inferTransport("trezor")).toBe(SignerSessionTransport.HARDWARE);
    expect(inferTransport("albedo")).toBe(SignerSessionTransport.BROWSER);
    expect(inferTransport("freighter")).toBe(SignerSessionTransport.BROWSER);
    expect(inferTransport("mock-provider")).toBe(SignerSessionTransport.MOCK);
  });

  it("is case-insensitive", () => {
    expect(inferTransport("LEDGER")).toBe(SignerSessionTransport.HARDWARE);
  });

  it("falls back to remote for anything unrecognised", () => {
    expect(inferTransport("some-custom-signer")).toBe(SignerSessionTransport.REMOTE);
  });
});

describe("diffCapabilities", () => {
  it("returns nothing when capabilities are unchanged", () => {
    expect(diffCapabilities(BASE_CAPABILITIES, BASE_CAPABILITIES, 0)).toEqual([]);
  });

  it("returns nothing when either snapshot is missing", () => {
    expect(diffCapabilities(undefined, BASE_CAPABILITIES, 0)).toEqual([]);
    expect(diffCapabilities(BASE_CAPABILITIES, undefined, 0)).toEqual([]);
  });

  it("detects a boolean capability being lost", () => {
    const downgrades = diffCapabilities(
      BASE_CAPABILITIES,
      { ...BASE_CAPABILITIES, supportsMessageSigning: false },
      42
    );
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0].capability).toBe("supportsMessageSigning");
    expect(downgrades[0].detectedAt).toBe(42);
  });

  it("ignores a capability being gained", () => {
    const downgrades = diffCapabilities(
      { ...BASE_CAPABILITIES, supportsMessageSigning: false },
      BASE_CAPABILITIES,
      0
    );
    expect(downgrades).toEqual([]);
  });

  it("detects a reduced concurrency limit but not an increased one", () => {
    expect(
      diffCapabilities(
        BASE_CAPABILITIES,
        { ...BASE_CAPABILITIES, maxConcurrentSignatures: 1 },
        0
      )
    ).toHaveLength(1);

    expect(
      diffCapabilities(
        BASE_CAPABILITIES,
        { ...BASE_CAPABILITIES, maxConcurrentSignatures: 50 },
        0
      )
    ).toHaveLength(0);
  });

  it("detects entries disappearing from a list capability", () => {
    const downgrades = diffCapabilities(
      BASE_CAPABILITIES,
      { ...BASE_CAPABILITIES, signingModes: ["transaction"] },
      0
    );
    expect(downgrades.map((d) => d.capability)).toContain("signingModes");
  });

  it("reports every regression, not just the first", () => {
    const downgrades = diffCapabilities(
      BASE_CAPABILITIES,
      {
        ...BASE_CAPABILITIES,
        supportsMessageSigning: false,
        supportsMultipleAccounts: false,
        maxConcurrentSignatures: 1,
      },
      0
    );
    expect(downgrades.length).toBe(3);
  });
});

describe("SignerSessionManager.open", () => {
  it("moves a session to ACTIVE and records the baseline capabilities", async () => {
    const { manager } = setup();
    const provider = new FakeProvider();

    const session = await manager.open(provider);

    expect(session.status).toBe(SignerSessionStatus.ACTIVE);
    expect(session.connectionId).toBe("conn-1");
    expect(session.baselineCapabilities).toEqual(BASE_CAPABILITIES);
    expect(session.transport).toBe(SignerSessionTransport.MOCK);
  });

  it("records the DISCONNECTED → CONNECTING → ACTIVE path", async () => {
    const { manager } = setup();
    const session = await manager.open(new FakeProvider());

    expect(session.history.map((entry) => entry.to)).toEqual([
      SignerSessionStatus.CONNECTING,
      SignerSessionStatus.ACTIVE,
    ]);
  });

  it("honours an explicit transport override", async () => {
    const { manager } = setup();
    const session = await manager.open(new FakeProvider(), {
      transport: SignerSessionTransport.HARDWARE,
    });
    expect(session.transport).toBe(SignerSessionTransport.HARDWARE);
  });

  it("applies transport defaults under caller overrides", async () => {
    const { manager } = setup();
    const session = await manager.open(new FakeProvider("ledger"), {
      policy: { idleTimeoutMs: 999 },
    });
    const policy = manager.policyFor(session.id);

    expect(policy.idleTimeoutMs).toBe(999);
    // Untouched hardware default survives the merge.
    expect(policy.maxReconnectAttempts).toBe(5);
  });

  it("moves to ERROR and rethrows when the provider throws", async () => {
    const { manager } = setup();
    const provider = new FakeProvider();
    provider.failNextConnect = true;

    await expect(manager.open(provider, { sessionId: "s1" })).rejects.toThrow(
      "device unavailable"
    );
    expect(manager.get("s1")?.status).toBe(SignerSessionStatus.ERROR);
    expect(manager.get("s1")?.lastError).toBe("device unavailable");
  });

  it("treats an unsuccessful connection result as a failure", async () => {
    const { manager } = setup();
    const provider = new FakeProvider();
    provider.reportUnsuccessful = true;

    await expect(manager.open(provider, { sessionId: "s1" })).rejects.toThrow();
    expect(manager.get("s1")?.status).toBe(SignerSessionStatus.ERROR);
  });

  it("stores caller metadata on the session", async () => {
    const { manager } = setup();
    const session = await manager.open(new FakeProvider(), {
      metadata: { origin: "unit-test" },
    });
    expect(session.metadata).toEqual({ origin: "unit-test" });
  });
});

describe("SignerSessionManager staleness and expiry", () => {
  it("goes STALE once the idle timeout elapses", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 1_000, maxLifetimeMs: 100_000 });
    const session = await manager.open(new FakeProvider());

    clock.advance(1_000);
    expect(manager.evaluate(session.id).status).toBe(SignerSessionStatus.STALE);
  });

  it("stays ACTIVE just below the idle timeout", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 1_000, maxLifetimeMs: 100_000 });
    const session = await manager.open(new FakeProvider());

    clock.advance(999);
    expect(manager.evaluate(session.id).status).toBe(SignerSessionStatus.ACTIVE);
  });

  it("returns a stale session to ACTIVE when touched", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 1_000, maxLifetimeMs: 100_000 });
    const session = await manager.open(new FakeProvider());

    clock.advance(1_500);
    expect(manager.evaluate(session.id).status).toBe(SignerSessionStatus.STALE);
    expect(manager.touch(session.id).status).toBe(SignerSessionStatus.ACTIVE);
  });

  it("expires on absolute lifetime even when recently active", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 100_000, maxLifetimeMs: 2_000 });
    const session = await manager.open(new FakeProvider());

    clock.advance(1_000);
    manager.touch(session.id);
    clock.advance(1_000);

    expect(manager.evaluate(session.id).status).toBe(SignerSessionStatus.EXPIRED);
  });

  it("prefers expiry over staleness when both apply", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 500, maxLifetimeMs: 1_000 });
    const session = await manager.open(new FakeProvider());

    clock.advance(5_000);
    expect(manager.evaluate(session.id).status).toBe(SignerSessionStatus.EXPIRED);
  });

  it("refuses to revive an expired session by touching it", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 500, maxLifetimeMs: 1_000 });
    const session = await manager.open(new FakeProvider());

    clock.advance(5_000);
    manager.evaluate(session.id);
    expect(manager.touch(session.id).status).toBe(SignerSessionStatus.EXPIRED);
  });

  it("reports usability through isUsable", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 1_000, maxLifetimeMs: 100_000 });
    const session = await manager.open(new FakeProvider());

    expect(manager.isUsable(session.id)).toBe(true);
    clock.advance(2_000);
    expect(manager.isUsable(session.id)).toBe(false);
  });
});

describe("SignerSessionManager.reconnect", () => {
  it("restores a stale session to ACTIVE with a fresh connection id", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 1_000, maxLifetimeMs: 100_000 });
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    clock.advance(1_500);
    manager.evaluate(session.id);
    const reconnected = await manager.reconnect(session.id, provider);

    expect(reconnected.status).toBe(SignerSessionStatus.ACTIVE);
    expect(reconnected.connectionId).toBe("conn-2");
    expect(reconnected.reconnectAttempts).toBe(1);
  });

  it("disconnects a still-connected provider before reconnecting", async () => {
    const { manager } = setup();
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    await manager.reconnect(session.id, provider);
    expect(provider.disconnectCalls).toBe(1);
  });

  it("records a downgrade but stays ACTIVE when the policy allows it", async () => {
    const { manager } = setup({ allowCapabilityDowngrade: true });
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    provider.setCapabilities({
      ...BASE_CAPABILITIES,
      supportsMessageSigning: false,
    });
    const reconnected = await manager.reconnect(session.id, provider);

    expect(reconnected.status).toBe(SignerSessionStatus.ACTIVE);
    expect(reconnected.downgrades).toHaveLength(1);
  });

  it("revokes instead of downgrading when the policy forbids it", async () => {
    const { manager } = setup({ allowCapabilityDowngrade: false });
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    provider.setCapabilities({
      ...BASE_CAPABILITIES,
      supportsMessageSigning: false,
    });
    const reconnected = await manager.reconnect(session.id, provider);

    expect(reconnected.status).toBe(SignerSessionStatus.REVOKED);
    expect(reconnected.revocationReason).toBe(
      SignerSessionRevocationReason.POLICY_VIOLATION
    );
  });

  it("throws once the reconnect budget is exhausted", async () => {
    const { manager } = setup({ maxReconnectAttempts: 1 });
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    await manager.reconnect(session.id, provider);
    await expect(manager.reconnect(session.id, provider)).rejects.toThrow(
      /exhausted/
    );
  });

  it("refuses to reconnect an expired session", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 500, maxLifetimeMs: 1_000 });
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    clock.advance(5_000);
    manager.evaluate(session.id);

    await expect(manager.reconnect(session.id, provider)).rejects.toThrow(
      /must be reopened/
    );
  });

  it("refuses to reconnect a revoked session", async () => {
    const { manager } = setup();
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    manager.revoke(session.id);
    await expect(manager.reconnect(session.id, provider)).rejects.toThrow(/revoked/);
  });

  it("moves to ERROR when the reconnect attempt fails", async () => {
    const { manager } = setup();
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    provider.failNextConnect = true;
    await expect(manager.reconnect(session.id, provider)).rejects.toThrow();
    expect(manager.get(session.id)?.status).toBe(SignerSessionStatus.ERROR);
  });
});

describe("SignerSessionManager revocation, close and bookkeeping", () => {
  it("is idempotent when revoking twice", async () => {
    const { manager } = setup();
    const session = await manager.open(new FakeProvider());

    manager.revoke(session.id, SignerSessionRevocationReason.SECURITY);
    const before = session.history.length;
    manager.revoke(session.id, SignerSessionRevocationReason.USER_REQUESTED);

    expect(session.history.length).toBe(before);
    expect(session.revocationReason).toBe(SignerSessionRevocationReason.SECURITY);
  });

  it("closes cleanly to DISCONNECTED and disconnects the provider", async () => {
    const { manager } = setup();
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    const closed = await manager.close(session.id, provider);

    expect(closed.status).toBe(SignerSessionStatus.DISCONNECTED);
    expect(closed.connectionId).toBeUndefined();
    expect(provider.disconnectCalls).toBe(1);
  });

  it("does not downgrade a revoked session when closing", async () => {
    const { manager } = setup();
    const provider = new FakeProvider();
    const session = await manager.open(provider);

    manager.revoke(session.id);
    const closed = await manager.close(session.id, provider);
    expect(closed.status).toBe(SignerSessionStatus.REVOKED);
  });

  it("reports unusable sessions from sweep", async () => {
    const { clock, manager } = setup({ idleTimeoutMs: 1_000, maxLifetimeMs: 100_000 });
    await manager.open(new FakeProvider(), { sessionId: "a" });
    await manager.open(new FakeProvider(), { sessionId: "b" });

    clock.advance(1_500);
    manager.touch("b");

    expect(manager.sweep().map((session) => session.id)).toEqual(["a"]);
  });

  it("prunes terminal sessions only", async () => {
    const { manager } = setup();
    await manager.open(new FakeProvider(), { sessionId: "keep" });
    await manager.open(new FakeProvider(), { sessionId: "drop" });
    manager.revoke("drop");

    expect(manager.prune()).toBe(1);
    expect(manager.list().map((session) => session.id)).toEqual(["keep"]);
  });

  it("notifies listeners and supports unsubscribing", async () => {
    const { manager } = setup();
    const seen: string[] = [];
    const unsubscribe = manager.onTransition((_, transition) =>
      seen.push(transition.to)
    );

    const session = await manager.open(new FakeProvider());
    expect(seen).toEqual([
      SignerSessionStatus.CONNECTING,
      SignerSessionStatus.ACTIVE,
    ]);

    unsubscribe();
    manager.revoke(session.id);
    expect(seen).toHaveLength(2);
  });

  it("does not let a throwing listener break the lifecycle", async () => {
    const { manager } = setup();
    manager.onTransition(() => {
      throw new Error("listener exploded");
    });

    await expect(manager.open(new FakeProvider())).resolves.toMatchObject({
      status: SignerSessionStatus.ACTIVE,
    });
  });

  it("throws for unknown session ids", () => {
    const { manager } = setup();
    expect(() => manager.evaluate("nope")).toThrow(/Unknown session/);
    expect(() => manager.policyFor("nope")).toThrow(/Unknown session/);
    expect(manager.get("nope")).toBeUndefined();
  });
});
