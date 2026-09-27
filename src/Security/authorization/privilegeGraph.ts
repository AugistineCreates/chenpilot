/**
 * Versioned, machine-checkable privilege graph.
 *
 * Nodes are principals (users, roles, bots, services) and resources
 * (operations / financial side effects). Edges are grants, delegations
 * (principal → principal) and explicit bypasses (admin / emergency paths,
 * always tagged so they are visible in audits). The graph can be diffed in CI
 * to flag new privilege edges and queried for who can cause a side effect.
 */

export const PRIVILEGE_GRAPH_VERSION = 1;

export type EdgeKind = "grant" | "delegation" | "bypass";

export interface PrivilegeEdge {
  kind: EdgeKind;
  from: string;
  to: string;
  /** Required for bypass edges: why the path exists (e.g. "emergency-freeze"). */
  justification?: string;
}

export interface PolicyCheck {
  id: string;
  /** Resource this check guards. */
  resource: string;
}

export interface PrivilegeGraph {
  version: number;
  principals: string[];
  resources: string[];
  edges: PrivilegeEdge[];
  checks: PolicyCheck[];
}

export function edgeKey(e: PrivilegeEdge): string {
  return `${e.kind}:${e.from}->${e.to}`;
}

/** Throws when the graph is malformed or a bypass is not justified. */
export function validateGraph(graph: PrivilegeGraph): void {
  if (graph.version !== PRIVILEGE_GRAPH_VERSION) {
    throw new Error(`Unsupported privilege graph version ${graph.version}`);
  }
  const principals = new Set(graph.principals);
  const resources = new Set(graph.resources);
  for (const e of graph.edges) {
    if (!principals.has(e.from)) throw new Error(`Unknown principal ${e.from} in ${edgeKey(e)}`);
    const targetOk = e.kind === "delegation" ? principals.has(e.to) : resources.has(e.to);
    if (!targetOk) throw new Error(`Unknown target ${e.to} in ${edgeKey(e)}`);
    if (e.kind === "bypass" && !e.justification?.trim()) {
      throw new Error(`Bypass ${edgeKey(e)} must declare a justification`);
    }
  }
}

/** Principals that can reach `resource` through grants, bypasses and delegation chains. */
export function whoCanCause(graph: PrivilegeGraph, resource: string): string[] {
  const direct = new Set(
    graph.edges.filter((e) => e.kind !== "delegation" && e.to === resource).map((e) => e.from),
  );
  // A principal that delegates to X inherits X's reach, so walk delegation edges backwards.
  const result = new Set(direct);
  const queue = [...direct];
  while (queue.length) {
    const target = queue.shift()!;
    for (const e of graph.edges) {
      if (e.kind === "delegation" && e.to === target && !result.has(e.from)) {
        result.add(e.from);
        queue.push(e.from);
      }
    }
  }
  return [...result].sort();
}

/** Edges present in `next` but not in `previous` — CI should flag these for review. */
export function newPrivilegeEdges(previous: PrivilegeGraph, next: PrivilegeGraph): PrivilegeEdge[] {
  const known = new Set(previous.edges.map(edgeKey));
  return next.edges.filter((e) => !known.has(edgeKey(e)));
}

/** Policy checks guarding resources no principal can reach (dead or misconfigured checks). */
export function unreachablePolicyChecks(graph: PrivilegeGraph): PolicyCheck[] {
  return graph.checks.filter((c) => whoCanCause(graph, c.resource).length === 0);
}

/** All bypass edges, for audit output. */
export function bypassPaths(graph: PrivilegeGraph): PrivilegeEdge[] {
  return graph.edges.filter((e) => e.kind === "bypass");
}

/** Stable serialization so the committed graph diffs cleanly in review. */
export function serializeGraph(graph: PrivilegeGraph): string {
  const sorted: PrivilegeGraph = {
    version: graph.version,
    principals: [...graph.principals].sort(),
    resources: [...graph.resources].sort(),
    edges: [...graph.edges].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b))),
    checks: [...graph.checks].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return JSON.stringify(sorted, null, 2) + "\n";
}
