/**
 * DependencyGraph
 *
 * Derives an executable dependency graph from a set of PlanSteps.
 * Responsibilities:
 *   - Build adjacency list from PlanStep.dependencies[]
 *   - Detect cycles (throws on invalid plans)
 *   - Produce execution waves via Kahn's topological sort
 *     where a "wave" is a set of steps that may run in parallel
 *   - Track per-step conflict resources so the scheduler can serialize
 *     steps that touch the same wallet, quote, lock, or approval object
 */

import { PlanStep } from "./AgentPlanner";
import logger from "../../config/logger";

/** A group of step numbers that are ready to run concurrently. */
export type ExecutionWave = readonly number[];

/**
 * Resource keys extracted from a step payload that identify shared mutable
 * state. The scheduler uses these to serialize steps that conflict.
 *
 * Convention:  `<kind>:<id>`
 * Examples:    `wallet:G…XLM`, `quote:abc123`, `lock:trade:user-1`, `approval:step-3`
 */
export type ResourceKey = string;

/** Metadata stored per step in the graph. */
export interface StepNode {
  stepNumber: number;
  /** Upstream step numbers this step directly depends on. */
  dependencies: ReadonlySet<number>;
  /** Downstream step numbers that depend on this step. */
  dependents: Set<number>;
  /** Shared-resource keys that must be held exclusively during execution. */
  conflictResources: ReadonlySet<ResourceKey>;
}

/** Result of a full graph build. */
export interface GraphBuildResult {
  /** Ordered sequence of parallel waves, each wave safe to run concurrently. */
  waves: ExecutionWave[];
  /** Map from stepNumber → StepNode for O(1) look-ups. */
  nodes: ReadonlyMap<number, StepNode>;
}

// ---------------------------------------------------------------------------
// Resource extraction helpers
// ---------------------------------------------------------------------------

/**
 * Well-known payload keys that identify conflict resources.
 * Extend this as new DeFi operations are added.
 */
const WALLET_KEYS = ["walletId", "fromWallet", "toWallet", "userId", "fromAddress", "toAddress"] as const;
const QUOTE_KEYS = ["quoteId", "quote", "quoteToken"] as const;
const LOCK_KEYS = ["lockKey", "resourceKey", "tradeId"] as const;
const APPROVAL_KEYS = ["approvalId", "spender", "tokenAddress"] as const;

function extractResourceKeys(step: PlanStep): Set<ResourceKey> {
  const resources = new Set<ResourceKey>();
  const payload = step.payload as Record<string, unknown>;

  for (const key of WALLET_KEYS) {
    const val = payload[key];
    if (typeof val === "string" && val) {
      resources.add(`wallet:${val}`);
    }
  }

  for (const key of QUOTE_KEYS) {
    const val = payload[key];
    if (typeof val === "string" && val) {
      resources.add(`quote:${val}`);
    }
  }

  for (const key of LOCK_KEYS) {
    const val = payload[key];
    if (typeof val === "string" && val) {
      resources.add(`lock:${val}`);
    }
  }

  for (const key of APPROVAL_KEYS) {
    const val = payload[key];
    if (typeof val === "string" && val) {
      resources.add(`approval:${val}`);
    }
  }

  // Any action that explicitly names a conflictResources array in its payload
  const explicit = payload["conflictResources"];
  if (Array.isArray(explicit)) {
    for (const r of explicit) {
      if (typeof r === "string" && r) {
        resources.add(r);
      }
    }
  }

  return resources;
}

// ---------------------------------------------------------------------------
// DependencyGraph
// ---------------------------------------------------------------------------

export class DependencyGraph {
  /**
   * Build a dependency graph and compute parallel execution waves.
   *
   * @param steps - All steps in the execution plan (order-independent).
   * @returns A GraphBuildResult containing waves and indexed nodes.
   * @throws Error if the dependency graph contains a cycle.
   */
  static build(steps: readonly PlanStep[]): GraphBuildResult {
    if (steps.length === 0) {
      return { waves: [], nodes: new Map() };
    }

    const nodes = new Map<number, StepNode>();

    // Pass 1: create all nodes
    for (const step of steps) {
      nodes.set(step.stepNumber, {
        stepNumber: step.stepNumber,
        dependencies: new Set(step.dependencies ?? []),
        dependents: new Set(),
        conflictResources: extractResourceKeys(step),
      });
    }

    // Pass 2: populate reverse edges (dependents)
    for (const node of nodes.values()) {
      for (const depNum of node.dependencies) {
        const depNode = nodes.get(depNum);
        if (!depNode) {
          throw new Error(
            `Step ${node.stepNumber} declares dependency on unknown step ${depNum}`
          );
        }
        depNode.dependents.add(node.stepNumber);
      }
    }

    // Pass 3: Kahn's algorithm to produce waves and detect cycles
    const waves = DependencyGraph.kahnSort(nodes);

    logger.debug("DependencyGraph built", {
      stepCount: steps.length,
      waveCount: waves.length,
      waves: waves.map((w) => [...w]),
    });

    return { waves, nodes };
  }

  /**
   * Kahn's topological sort — groups steps into parallel execution waves.
   * Each wave contains steps whose dependencies are fully satisfied by
   * all prior waves.
   */
  private static kahnSort(nodes: Map<number, StepNode>): ExecutionWave[] {
    // in-degree map (mutable copy of dependency counts)
    const inDegree = new Map<number, number>();
    for (const [num, node] of nodes) {
      inDegree.set(num, node.dependencies.size);
    }

    const waves: ExecutionWave[] = [];
    let remaining = nodes.size;

    while (remaining > 0) {
      // Collect all zero-in-degree nodes — deterministic order: sort ascending
      const ready: number[] = [];
      for (const [num, deg] of inDegree) {
        if (deg === 0) {
          ready.push(num);
        }
      }

      if (ready.length === 0) {
        // Cycle detected: find which steps are still in the graph
        const cycleNodes = [...inDegree.keys()]
          .filter((n) => (inDegree.get(n) ?? 0) > 0)
          .sort((a, b) => a - b);
        throw new Error(
          `Cycle detected in dependency graph involving steps: ${cycleNodes.join(", ")}`
        );
      }

      // Sort for determinism within a wave
      ready.sort((a, b) => a - b);
      waves.push(Object.freeze(ready));

      // Remove processed nodes and decrement dependent counts
      for (const num of ready) {
        inDegree.delete(num);
        const node = nodes.get(num)!;
        for (const dep of node.dependents) {
          inDegree.set(dep, (inDegree.get(dep) ?? 0) - 1);
        }
        remaining--;
      }
    }

    return waves;
  }

  /**
   * Returns the set of step numbers that are transitive successors of a given
   * step — i.e., steps that would be "orphaned" if the given step fails.
   *
   * Used by compensation logic to identify which downstream steps to cancel.
   */
  static getDownstreamSteps(
    failedStep: number,
    nodes: ReadonlyMap<number, StepNode>
  ): Set<number> {
    const downstream = new Set<number>();
    const queue: number[] = [failedStep];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = nodes.get(current);
      if (!node) continue;

      for (const dep of node.dependents) {
        if (!downstream.has(dep)) {
          downstream.add(dep);
          queue.push(dep);
        }
      }
    }

    return downstream;
  }

  /**
   * Returns the reverse-topological order of completed ancestors — the order
   * in which rollback/compensation actions should be applied.
   *
   * Steps are returned last-completed-first so that compensation "unwinds"
   * the execution in a safe order.
   */
  static getCompensationOrder(
    completedSteps: readonly number[],
    nodes: ReadonlyMap<number, StepNode>
  ): number[] {
    // Build subgraph of completed steps
    const completedSet = new Set(completedSteps);

    // Topological sort of completed steps (reusing Kahn's) then reverse
    const subNodes = new Map<number, StepNode>();
    for (const num of completedSet) {
      const node = nodes.get(num);
      if (node) {
        subNodes.set(num, {
          ...node,
          // Only retain edges within completed subgraph
          dependencies: new Set(
            [...node.dependencies].filter((d) => completedSet.has(d))
          ),
          dependents: new Set(
            [...node.dependents].filter((d) => completedSet.has(d))
          ),
        });
      }
    }

    if (subNodes.size === 0) return [];

    const forwardOrder = DependencyGraph.kahnSort(subNodes)
      .flat()
      .map((n) => n);

    // Reverse for compensation (undo last-first)
    return forwardOrder.reverse();
  }
}
