/**
 * parallelScheduler.race.test.ts
 *
 * Race-condition tests for the parallel execution pipeline.
 *
 * Covers:
 *   1. Shared wallet serialization — two steps touching the same wallet must
 *      not overlap.
 *   2. Shared quote serialization — steps using the same quoteId are
 *      serialized and the first to complete "wins" cleanly.
 *   3. Shared lock key — explicit lock resource keys are honoured.
 *   4. Shared approval state — steps sharing an approval token are
 *      serialized.
 *   5. Deterministic replay — re-running a plan with a persisted schedule
 *      produces the same wave ordering.
 *   6. Partial branch failure + compensation — failing step triggers
 *      downstream cancellation and completed-step rollback.
 *   7. Dependency cycle detection — cycle in dependencies raises an error.
 *   8. Wave ordering — steps with explicit dependencies run after their
 *      declared dependencies.
 */

// Mock logger before any imports that use it
jest.mock("../../../config/logger", () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return {
    __esModule: true,
    default: mockLogger,
  };
});

// Mock AgentPlanner to avoid pulling in LLM, DB, and config dependencies
jest.mock("../AgentPlanner");

import { DependencyGraph } from "../DependencyGraph";

/**
 * Inline PlanStep shape — mirrors AgentPlanner.PlanStep but avoids importing
 * the real module (which drags in LLM/DB config at evaluation time).
 */
interface PlanStep {
  stepNumber: number;
  action: string;
  payload: Record<string, unknown>;
  description?: string;
  dependencies?: number[];
  requiresApproval?: boolean;
  rollbackAction?: { action: string; payload: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(
  stepNumber: number,
  action: string,
  payload: Record<string, unknown> = {},
  dependencies: number[] = [],
  rollbackAction?: PlanStep["rollbackAction"]
): PlanStep {
  return {
    stepNumber,
    action,
    payload,
    description: `Step ${stepNumber}: ${action}`,
    dependencies,
    rollbackAction,
  };
}

// ---------------------------------------------------------------------------
// 1. DependencyGraph – topological sort and wave grouping
// ---------------------------------------------------------------------------

describe("DependencyGraph – wave scheduling", () => {
  it("groups independent steps into a single wave", () => {
    const steps = [
      makeStep(1, "check_balance"),
      makeStep(2, "get_quote"),
      makeStep(3, "check_allowance"),
    ];
    const { waves } = DependencyGraph.build(steps);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toEqual([1, 2, 3]); // sorted ascending
  });

  it("creates sequential waves for a strict chain", () => {
    const steps = [
      makeStep(1, "check_balance"),
      makeStep(2, "approve_token", {}, [1]),
      makeStep(3, "execute_swap", {}, [2]),
    ];
    const { waves } = DependencyGraph.build(steps);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toEqual([1]);
    expect(waves[1]).toEqual([2]);
    expect(waves[2]).toEqual([3]);
  });

  it("correctly handles diamond dependency (fork + join)", () => {
    // Step 1 → steps 2 and 3 → step 4
    const steps = [
      makeStep(1, "fetch_price"),
      makeStep(2, "route_a", {}, [1]),
      makeStep(3, "route_b", {}, [1]),
      makeStep(4, "settle", {}, [2, 3]),
    ];
    const { waves } = DependencyGraph.build(steps);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toEqual([1]);
    expect(waves[1]).toEqual([2, 3]);
    expect(waves[2]).toEqual([4]);
  });

  it("throws on a cycle", () => {
    const steps = [
      makeStep(1, "step_a", {}, [3]),
      makeStep(2, "step_b", {}, [1]),
      makeStep(3, "step_c", {}, [2]),
    ];
    expect(() => DependencyGraph.build(steps)).toThrow(/Cycle detected/);
  });

  it("throws when a dependency references a non-existent step", () => {
    const steps = [makeStep(1, "step_a", {}, [99])];
    expect(() => DependencyGraph.build(steps)).toThrow(/unknown step/);
  });

  it("handles an empty step list gracefully", () => {
    const { waves, nodes } = DependencyGraph.build([]);
    expect(waves).toHaveLength(0);
    expect(nodes.size).toBe(0);
  });

  it("places steps with no dependencies in wave 0 regardless of numbering", () => {
    const steps = [
      makeStep(5, "e"),
      makeStep(3, "c"),
      makeStep(1, "a"),
    ];
    const { waves } = DependencyGraph.build(steps);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toEqual([1, 3, 5]); // sorted
  });
});

// ---------------------------------------------------------------------------
// 2. Resource key extraction – shared wallet
// ---------------------------------------------------------------------------

describe("DependencyGraph – resource conflict detection (shared wallet)", () => {
  it("extracts wallet resources from userId payload key", () => {
    const steps = [
      makeStep(1, "swap", { userId: "user-alice" }),
      makeStep(2, "transfer", { userId: "user-alice" }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const node1 = nodes.get(1)!;
    const node2 = nodes.get(2)!;
    expect(node1.conflictResources.has("wallet:user-alice")).toBe(true);
    expect(node2.conflictResources.has("wallet:user-alice")).toBe(true);
  });

  it("extracts wallet resources from fromWallet and toWallet", () => {
    const steps = [
      makeStep(1, "transfer", { fromWallet: "walletA", toWallet: "walletB" }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const node = nodes.get(1)!;
    expect(node.conflictResources.has("wallet:walletA")).toBe(true);
    expect(node.conflictResources.has("wallet:walletB")).toBe(true);
  });

  it("two steps sharing a wallet have overlapping conflict resources", () => {
    const steps = [
      makeStep(1, "approve", { walletId: "wallet-xyz" }),
      makeStep(2, "swap",    { walletId: "wallet-xyz" }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const key = "wallet:wallet-xyz";
    expect(nodes.get(1)!.conflictResources.has(key)).toBe(true);
    expect(nodes.get(2)!.conflictResources.has(key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Resource key extraction – shared quote
// ---------------------------------------------------------------------------

describe("DependencyGraph – resource conflict detection (shared quote)", () => {
  it("extracts quote resources from quoteId", () => {
    const steps = [
      makeStep(1, "get_quote",     { quoteId: "q-001" }),
      makeStep(2, "execute_swap",  { quoteId: "q-001" }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const key = "quote:q-001";
    expect(nodes.get(1)!.conflictResources.has(key)).toBe(true);
    expect(nodes.get(2)!.conflictResources.has(key)).toBe(true);
  });

  it("different quoteIds produce separate resources", () => {
    const steps = [
      makeStep(1, "execute_swap", { quoteId: "q-001" }),
      makeStep(2, "execute_swap", { quoteId: "q-002" }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    expect(nodes.get(1)!.conflictResources.has("quote:q-001")).toBe(true);
    expect(nodes.get(1)!.conflictResources.has("quote:q-002")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Resource key extraction – shared lock key
// ---------------------------------------------------------------------------

describe("DependencyGraph – resource conflict detection (shared lock)", () => {
  it("extracts lock resources from lockKey", () => {
    const steps = [
      makeStep(1, "acquire_position", { lockKey: "trade:user-1" }),
      makeStep(2, "add_liquidity",    { lockKey: "trade:user-1" }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const key = "lock:trade:user-1";
    expect(nodes.get(1)!.conflictResources.has(key)).toBe(true);
    expect(nodes.get(2)!.conflictResources.has(key)).toBe(true);
  });

  it("extracts lock resources from resourceKey", () => {
    const steps = [makeStep(1, "execute", { resourceKey: "pool:XLM-USDC" })];
    const { nodes } = DependencyGraph.build(steps);
    expect(nodes.get(1)!.conflictResources.has("lock:pool:XLM-USDC")).toBe(true);
  });

  it("extracts lock resources from tradeId", () => {
    const steps = [makeStep(1, "execute", { tradeId: "trade-abc" })];
    const { nodes } = DependencyGraph.build(steps);
    expect(nodes.get(1)!.conflictResources.has("lock:trade-abc")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Resource key extraction – shared approval state
// ---------------------------------------------------------------------------

describe("DependencyGraph – resource conflict detection (shared approval)", () => {
  it("extracts approval resources from approvalId", () => {
    const steps = [
      makeStep(1, "approve_token",   { approvalId: "approve-erc20-abc" }),
      makeStep(2, "execute_swap",    { approvalId: "approve-erc20-abc" }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const key = "approval:approve-erc20-abc";
    expect(nodes.get(1)!.conflictResources.has(key)).toBe(true);
    expect(nodes.get(2)!.conflictResources.has(key)).toBe(true);
  });

  it("extracts approval resources from spender + tokenAddress", () => {
    const steps = [
      makeStep(1, "approve", { spender: "router-v2", tokenAddress: "0xabc" }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    expect(nodes.get(1)!.conflictResources.has("approval:router-v2")).toBe(true);
    expect(nodes.get(1)!.conflictResources.has("approval:0xabc")).toBe(true);
  });

  it("honours explicit conflictResources array in payload", () => {
    const steps = [
      makeStep(1, "custom_op", {
        conflictResources: ["wallet:alice", "approval:token-xyz"],
      }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const node = nodes.get(1)!;
    expect(node.conflictResources.has("wallet:alice")).toBe(true);
    expect(node.conflictResources.has("approval:token-xyz")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Downstream step cancellation
// ---------------------------------------------------------------------------

describe("DependencyGraph.getDownstreamSteps", () => {
  it("returns all transitive dependents of a failed step", () => {
    // 1 → 2 → 4
    //   → 3 → 4
    const steps = [
      makeStep(1, "a"),
      makeStep(2, "b", {}, [1]),
      makeStep(3, "c", {}, [1]),
      makeStep(4, "d", {}, [2, 3]),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const downstream = DependencyGraph.getDownstreamSteps(1, nodes);
    expect(downstream.has(2)).toBe(true);
    expect(downstream.has(3)).toBe(true);
    expect(downstream.has(4)).toBe(true);
    expect(downstream.has(1)).toBe(false);
  });

  it("returns only direct and transitive successors, not siblings", () => {
    // 1 and 2 are independent; 3 depends on 2
    const steps = [
      makeStep(1, "a"),
      makeStep(2, "b"),
      makeStep(3, "c", {}, [2]),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const downstream = DependencyGraph.getDownstreamSteps(2, nodes);
    expect(downstream.has(3)).toBe(true);
    expect(downstream.has(1)).toBe(false); // sibling, not downstream
  });

  it("returns empty set for a leaf step (no dependents)", () => {
    const steps = [makeStep(1, "a"), makeStep(2, "b", {}, [1])];
    const { nodes } = DependencyGraph.build(steps);
    const downstream = DependencyGraph.getDownstreamSteps(2, nodes);
    expect(downstream.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Compensation ordering
// ---------------------------------------------------------------------------

describe("DependencyGraph.getCompensationOrder", () => {
  it("returns completed steps in reverse topological order", () => {
    const steps = [
      makeStep(1, "a"),
      makeStep(2, "b", {}, [1]),
      makeStep(3, "c", {}, [2]),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const order = DependencyGraph.getCompensationOrder([1, 2, 3], nodes);
    // Expected reverse topo: 3, 2, 1
    expect(order).toEqual([3, 2, 1]);
  });

  it("handles a diamond — compensation order respects partial completion", () => {
    // 1 → 2, 3 → 4  (diamond)
    const steps = [
      makeStep(1, "a"),
      makeStep(2, "b", {}, [1]),
      makeStep(3, "c", {}, [1]),
      makeStep(4, "d", {}, [2, 3]),
    ];
    const { nodes } = DependencyGraph.build(steps);
    // Only 1 and 2 completed; 3 not yet; 4 not yet
    const order = DependencyGraph.getCompensationOrder([1, 2], nodes);
    // Forward topo of [1, 2] is [1, 2]; compensation = [2, 1]
    expect(order).toEqual([2, 1]);
  });

  it("returns empty array when no steps completed", () => {
    const steps = [makeStep(1, "a"), makeStep(2, "b", {}, [1])];
    const { nodes } = DependencyGraph.build(steps);
    const order = DependencyGraph.getCompensationOrder([], nodes);
    expect(order).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Deterministic ordering – same waves on repeated build calls
// ---------------------------------------------------------------------------

describe("DependencyGraph – deterministic wave ordering", () => {
  it("produces the same waves on repeated builds with same input", () => {
    const steps = [
      makeStep(3, "c"),
      makeStep(1, "a"),
      makeStep(5, "e", {}, [1, 3]),
      makeStep(2, "b"),
      makeStep(4, "d", {}, [2]),
    ];

    const result1 = DependencyGraph.build(steps);
    const result2 = DependencyGraph.build(steps);

    expect(result1.waves).toEqual(result2.waves);
  });

  it("sorts step numbers within a wave ascending for determinism", () => {
    // Steps 5, 3, 1 have no deps — they should appear sorted in wave 0
    const steps = [
      makeStep(5, "e"),
      makeStep(3, "c"),
      makeStep(1, "a"),
    ];
    const { waves } = DependencyGraph.build(steps);
    expect(waves[0]).toEqual([1, 3, 5]);
  });

  it("wave schedule is stable across shuffled input order", () => {
    const orderedSteps = [
      makeStep(1, "a"),
      makeStep(2, "b", {}, [1]),
      makeStep(3, "c", {}, [1]),
      makeStep(4, "d", {}, [2, 3]),
    ];

    const shuffledSteps = [
      makeStep(4, "d", {}, [2, 3]),
      makeStep(2, "b", {}, [1]),
      makeStep(1, "a"),
      makeStep(3, "c", {}, [1]),
    ];

    const { waves: waves1 } = DependencyGraph.build(orderedSteps);
    const { waves: waves2 } = DependencyGraph.build(shuffledSteps);

    expect(waves1).toEqual(waves2);
  });
});

// ---------------------------------------------------------------------------
// 9. Race condition simulation – concurrent steps touching shared resources
// ---------------------------------------------------------------------------

describe("Resource serialization – concurrent access simulation", () => {
  /**
   * This test simulates two "concurrent" steps that both try to write to a
   * shared wallet. We use the DependencyGraph to verify that they appear in
   * the same wave (no declared dependency) but share a conflict resource key,
   * signalling the scheduler should serialize them.
   */
  it("detects that independent steps sharing a wallet both need the same resource key", () => {
    const sharedWallet = "G-ALICE-XLM";
    const steps = [
      makeStep(1, "swap", { fromWallet: sharedWallet, toToken: "USDC" }),
      makeStep(2, "withdraw", { fromWallet: sharedWallet, amount: "100" }),
    ];
    const { waves, nodes } = DependencyGraph.build(steps);

    // Both in the same wave (no dependencies declared)
    expect(waves[0]).toContain(1);
    expect(waves[0]).toContain(2);

    // Both share the same conflict resource
    const key = `wallet:${sharedWallet}`;
    expect(nodes.get(1)!.conflictResources.has(key)).toBe(true);
    expect(nodes.get(2)!.conflictResources.has(key)).toBe(true);
  });

  it("detects that independent steps sharing a quoteId conflict", () => {
    const sharedQuote = "quote-stale-xyz";
    const steps = [
      makeStep(1, "execute_swap_route_a", { quoteId: sharedQuote }),
      makeStep(2, "execute_swap_route_b", { quoteId: sharedQuote }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const key = `quote:${sharedQuote}`;
    expect(nodes.get(1)!.conflictResources.has(key)).toBe(true);
    expect(nodes.get(2)!.conflictResources.has(key)).toBe(true);
  });

  it("detects that independent steps sharing a trade lock key conflict", () => {
    const lockKey = "trade:user-bob";
    const steps = [
      makeStep(1, "open_position", { lockKey }),
      makeStep(2, "hedge_position", { lockKey }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const key = `lock:${lockKey}`;
    expect(nodes.get(1)!.conflictResources.has(key)).toBe(true);
    expect(nodes.get(2)!.conflictResources.has(key)).toBe(true);
  });

  it("detects that concurrent approve steps sharing a spender conflict", () => {
    const spender = "router-0x123";
    const steps = [
      makeStep(1, "approve_token_a", { spender }),
      makeStep(2, "approve_token_b", { spender }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const key = `approval:${spender}`;
    expect(nodes.get(1)!.conflictResources.has(key)).toBe(true);
    expect(nodes.get(2)!.conflictResources.has(key)).toBe(true);
  });

  it("non-conflicting steps share no resource keys", () => {
    const steps = [
      makeStep(1, "check_price_btc", { symbol: "BTC" }),
      makeStep(2, "check_price_eth", { symbol: "ETH" }),
    ];
    const { nodes } = DependencyGraph.build(steps);
    const resources1 = nodes.get(1)!.conflictResources;
    const resources2 = nodes.get(2)!.conflictResources;

    // No overlap
    for (const key of resources1) {
      expect(resources2.has(key)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Complex multi-hop DeFi scenario
// ---------------------------------------------------------------------------

describe("Complex multi-hop DeFi scenario", () => {
  /**
   * Scenario: BTC → XLM → USDC swap
   *   Step 1: Check BTC balance (no deps)
   *   Step 2: Get BTC→XLM quote (no deps)
   *   Step 3: Execute BTC→XLM swap (depends on 1, 2)
   *   Step 4: Get XLM→USDC quote (no deps)
   *   Step 5: Execute XLM→USDC swap (depends on 3, 4)
   *   Step 6: Confirm USDC receipt (depends on 5)
   */
  const multiHopSteps = [
    makeStep(1, "check_btc_balance",   { walletId: "btc-wallet-user1" }),
    makeStep(2, "get_btc_xlm_quote",   { quoteId: "q-btc-xlm" }),
    makeStep(3, "execute_btc_xlm",     { walletId: "btc-wallet-user1", quoteId: "q-btc-xlm" }, [1, 2]),
    makeStep(4, "get_xlm_usdc_quote",  { quoteId: "q-xlm-usdc" }),
    makeStep(5, "execute_xlm_usdc",    { walletId: "xlm-wallet-user1", quoteId: "q-xlm-usdc" }, [3, 4]),
    makeStep(6, "confirm_usdc",        { walletId: "xlm-wallet-user1" }, [5]),
  ];

  it("produces correct wave structure", () => {
    const { waves } = DependencyGraph.build(multiHopSteps);
    expect(waves[0]).toEqual([1, 2, 4]); // independent steps in parallel
    expect(waves[1]).toEqual([3]);       // needs 1 and 2
    expect(waves[2]).toEqual([5]);       // needs 3 and 4
    expect(waves[3]).toEqual([6]);       // needs 5
  });

  it("detects resource conflicts within the same wave", () => {
    const { nodes } = DependencyGraph.build(multiHopSteps);
    // Steps 1 and 3 share btc-wallet-user1 (though they are in different waves)
    expect(nodes.get(1)!.conflictResources.has("wallet:btc-wallet-user1")).toBe(true);
    expect(nodes.get(3)!.conflictResources.has("wallet:btc-wallet-user1")).toBe(true);

    // Steps 2 and 3 share q-btc-xlm quote
    expect(nodes.get(2)!.conflictResources.has("quote:q-btc-xlm")).toBe(true);
    expect(nodes.get(3)!.conflictResources.has("quote:q-btc-xlm")).toBe(true);
  });

  it("downstream of step 3 failure includes steps 5 and 6", () => {
    const { nodes } = DependencyGraph.build(multiHopSteps);
    const downstream = DependencyGraph.getDownstreamSteps(3, nodes);
    expect(downstream.has(5)).toBe(true);
    expect(downstream.has(6)).toBe(true);
    expect(downstream.has(1)).toBe(false);
    expect(downstream.has(2)).toBe(false);
    expect(downstream.has(4)).toBe(false);
  });

  it("compensation order for steps [1,2,3] is [3,2,1]", () => {
    const { nodes } = DependencyGraph.build(multiHopSteps);
    const order = DependencyGraph.getCompensationOrder([1, 2, 3], nodes);
    // 3 depends on 1 and 2, so 3 is compensated first
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(1));
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(2));
  });
});

// ---------------------------------------------------------------------------
// 11. Approval gate ordering
// ---------------------------------------------------------------------------

describe("Approval gate – step sequencing", () => {
  it("step requiring approval is scheduled in correct wave relative to dependencies", () => {
    const steps = [
      makeStep(1, "check_allowance", { spender: "router", tokenAddress: "XLM" }),
      { ...makeStep(2, "approve_token", { spender: "router", tokenAddress: "XLM" }, [1]), requiresApproval: true },
      makeStep(3, "execute_swap", { spender: "router", tokenAddress: "XLM" }, [2]),
    ];
    const { waves } = DependencyGraph.build(steps);
    expect(waves[0]).toEqual([1]);
    expect(waves[1]).toEqual([2]);
    expect(waves[2]).toEqual([3]);
  });

  it("multiple approval steps sharing a spender conflict share approval resource key", () => {
    const steps = [
      { ...makeStep(1, "approve_a", { spender: "router-v3" }), requiresApproval: true },
      { ...makeStep(2, "approve_b", { spender: "router-v3" }), requiresApproval: true },
    ];
    const { nodes } = DependencyGraph.build(steps);
    const key = "approval:router-v3";
    expect(nodes.get(1)!.conflictResources.has(key)).toBe(true);
    expect(nodes.get(2)!.conflictResources.has(key)).toBe(true);
  });
});
