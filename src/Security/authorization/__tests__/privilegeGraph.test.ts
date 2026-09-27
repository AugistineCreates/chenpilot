import { Principal, authorize } from "../channelPolicy";
import {
  PRIVILEGE_GRAPH_VERSION,
  PrivilegeGraph,
  bypassPaths,
  newPrivilegeEdges,
  serializeGraph,
  unreachablePolicyChecks,
  validateGraph,
  whoCanCause,
} from "../privilegeGraph";

function baseGraph(): PrivilegeGraph {
  return {
    version: PRIVILEGE_GRAPH_VERSION,
    principals: ["role:user", "role:admin", "bot:trader", "service:scheduler", "user:alice"],
    resources: ["payment:send", "admin:freeze", "swap:execute", "treasury:sweep"],
    edges: [
      { kind: "grant", from: "role:user", to: "payment:send" },
      { kind: "grant", from: "role:admin", to: "admin:freeze" },
      { kind: "delegation", from: "user:alice", to: "role:user" },
      { kind: "delegation", from: "bot:trader", to: "user:alice" },
      { kind: "grant", from: "bot:trader", to: "swap:execute" },
      { kind: "bypass", from: "service:scheduler", to: "admin:freeze", justification: "emergency-freeze" },
    ],
    checks: [
      { id: "payment-limit", resource: "payment:send" },
      { id: "treasury-quorum", resource: "treasury:sweep" },
    ],
  };
}

describe("privilege graph", () => {
  it("validates a well-formed graph", () => {
    expect(() => validateGraph(baseGraph())).not.toThrow();
  });

  it("rejects unknown nodes, versions and unjustified bypasses", () => {
    const g = baseGraph();
    expect(() => validateGraph({ ...g, version: 99 })).toThrow(/version/);
    expect(() => validateGraph({ ...g, edges: [{ kind: "grant", from: "ghost", to: "payment:send" }] })).toThrow(/ghost/);
    expect(() =>
      validateGraph({ ...g, edges: [{ kind: "bypass", from: "role:admin", to: "treasury:sweep" }] }),
    ).toThrow(/justification/);
  });

  it("answers who can cause a financial side effect, including delegation chains", () => {
    expect(whoCanCause(baseGraph(), "payment:send")).toEqual(["bot:trader", "role:user", "user:alice"]);
    expect(whoCanCause(baseGraph(), "admin:freeze")).toEqual(["role:admin", "service:scheduler"]);
  });

  it("makes administrative and emergency bypasses explicit", () => {
    expect(bypassPaths(baseGraph())).toEqual([
      { kind: "bypass", from: "service:scheduler", to: "admin:freeze", justification: "emergency-freeze" },
    ]);
  });

  it("flags new privilege edges for CI review", () => {
    const prev = baseGraph();
    const next = baseGraph();
    next.edges.push({ kind: "grant", from: "bot:trader", to: "treasury:sweep" });
    expect(newPrivilegeEdges(prev, next)).toEqual([{ kind: "grant", from: "bot:trader", to: "treasury:sweep" }]);
    expect(newPrivilegeEdges(prev, baseGraph())).toEqual([]);
  });

  it("flags policy checks no principal can reach", () => {
    expect(unreachablePolicyChecks(baseGraph()).map((c) => c.id)).toEqual(["treasury-quorum"]);
  });

  it("serializes deterministically regardless of input order", () => {
    const g = baseGraph();
    const shuffled = { ...g, edges: [...g.edges].reverse(), principals: [...g.principals].reverse() };
    expect(serializeGraph(shuffled)).toBe(serializeGraph(g));
  });

  it("matches runtime enforcement for direct grants", () => {
    const g = baseGraph();
    for (const resource of g.resources) {
      const holders = g.edges.filter((e) => e.kind === "grant" && e.to === resource).map((e) => e.from);
      for (const id of g.principals) {
        const principal: Principal = {
          id,
          grants: g.edges.filter((e) => e.kind === "grant" && e.from === id).map((e) => e.to),
        };
        expect(authorize(principal, resource, "http").allowed).toBe(holders.includes(id));
      }
    }
  });
});
