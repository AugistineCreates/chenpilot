import {
  Channel,
  DEFAULT_CHANNEL_POLICIES,
  Principal,
  authorize,
  authorizeJob,
  baseDecision,
} from "../channelPolicy";

const CHANNELS: Channel[] = ["http", "websocket", "bot", "job"];
const OPERATIONS = ["payment:send", "payment:read", "admin:freeze", "admin:unfreeze", "swap:execute"];
const GRANTS = ["payment:send", "payment:read", "payment:*", "admin:*", "swap:execute"];

/** Small deterministic PRNG so the fuzz run is reproducible. */
function prng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

function randomPrincipal(rand: () => number, i: number): Principal {
  return {
    id: `p${i}`,
    grants: GRANTS.filter(() => rand() < 0.4),
    suspended: rand() < 0.1,
  };
}

describe("channel-independent authorization", () => {
  it("gives equivalent principals equivalent decisions on unrestricted channels", () => {
    const user: Principal = { id: "u", grants: ["payment:send"] };
    for (const channel of ["http", "websocket", "job"] as Channel[]) {
      expect(authorize(user, "payment:send", channel)).toEqual({ allowed: true });
      expect(authorize(user, "admin:freeze", channel)).toEqual({ allowed: false, reason: "not_granted" });
    }
  });

  it("lets a channel restriction reduce but never grant authority", () => {
    const admin: Principal = { id: "a", grants: ["admin:*"] };
    expect(authorize(admin, "admin:freeze", "http")).toEqual({ allowed: true });
    expect(authorize(admin, "admin:freeze", "bot")).toEqual({ allowed: false, reason: "channel_restricted" });

    const permissive = { ...DEFAULT_CHANNEL_POLICIES, bot: { denied: [] } };
    const nobody: Principal = { id: "n", grants: [] };
    expect(authorize(nobody, "admin:freeze", "bot", permissive).allowed).toBe(false);
  });

  it("suspension wins on every channel", () => {
    const s: Principal = { id: "s", grants: ["payment:*"], suspended: true };
    for (const channel of CHANNELS) {
      expect(authorize(s, "payment:send", channel)).toEqual({ allowed: false, reason: "suspended" });
    }
  });

  describe("background jobs", () => {
    it("run with the originating identity", () => {
      const user: Principal = { id: "u", grants: ["payment:send"] };
      expect(authorizeJob({ originPrincipal: user, originChannel: "http" }, "payment:send")).toEqual({ allowed: true });
      expect(authorizeJob({ originPrincipal: user, originChannel: "http" }, "admin:freeze").allowed).toBe(false);
    });

    it("keep the origin channel's restrictions", () => {
      const admin: Principal = { id: "a", grants: ["admin:*"] };
      expect(authorizeJob({ originPrincipal: admin, originChannel: "bot" }, "admin:freeze")).toEqual({
        allowed: false,
        reason: "channel_restricted",
      });
    });

    it("are denied without an originating identity", () => {
      expect(authorizeJob(undefined, "payment:send")).toEqual({ allowed: false, reason: "missing_origin" });
    });
  });

  it("differential fuzz: no channel ever allows what the base decision denies", () => {
    const rand = prng(42);
    for (let i = 0; i < 500; i++) {
      const principal = randomPrincipal(rand, i);
      const twin: Principal = { ...principal, id: `${principal.id}-twin`, grants: [...principal.grants] };
      for (const op of OPERATIONS) {
        const base = baseDecision(principal, op);
        for (const channel of CHANNELS) {
          const decision = authorize(principal, op, channel);
          // Equivalent principals → identical decision on the same channel.
          expect(authorize(twin, op, channel)).toEqual(decision);
          // Channels may only reduce authority.
          if (!base.allowed) expect(decision.allowed).toBe(false);
        }
        const viaJob = authorizeJob({ originPrincipal: principal, originChannel: "http" }, op);
        expect(viaJob).toEqual(authorize(principal, op, "http"));
      }
    }
  });
});
