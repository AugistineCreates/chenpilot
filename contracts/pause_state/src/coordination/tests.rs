//! Tests for protocol-wide pause coordination (Issue #672).
//!
//! Covers:
//! - machine-readable dependency graph + scopes,
//! - downstream-first pause order and upstream-first unpause order,
//! - cycle detection (cannot safely order),
//! - partial-failure detection during pause propagation,
//! - withdrawal-safe degraded modes (exits remain available).

use super::*;
use crate::coordination::{
    inconsistent_nodes, plan_propagation_order, user_exits_available, ContractNode, PauseScope,
    PropagationDirection,
};
use soroban_sdk::{vec, Map};

fn vault_scope() -> PauseScope {
    PauseScope {
        deposits_blocked: true,
        withdrawals_open: true,
        claims_open: false,
        strategy_allocation_blocked: false,
        oracle_ops_blocked: false,
        flips_backend: false,
    }
}

fn htlc_scope() -> PauseScope {
    PauseScope {
        deposits_blocked: false,
        withdrawals_open: false,
        claims_open: true,
        strategy_allocation_blocked: false,
        oracle_ops_blocked: false,
        flips_backend: false,
    }
}

/// Build a small protocol graph:
///   UnifiedAuth (upstream) <- CoreVault <- FlashLoanGuard
///                          <- MultiHopSwap
///                 CoreVault <- LiquidityVault, Htlc
/// i.e. edges:
///   FlashLoanGuard -> CoreVault
///   MultiHopSwap   -> CoreVault
///   CoreVault      -> UnifiedAuth
///   LiquidityVault -> CoreVault
///   Htlc           -> CoreVault
fn protocol_graph(env: &Env) -> PauseDependencyGraph {
    let mut graph = PauseDependencyGraph::new(env);
    graph.add_dependency(ContractNode::FlashLoanGuard, ContractNode::CoreVault);
    graph.add_dependency(ContractNode::MultiHopSwap, ContractNode::CoreVault);
    graph.add_dependency(ContractNode::CoreVault, ContractNode::UnifiedAuth);
    graph.add_dependency(ContractNode::LiquidityVault, ContractNode::CoreVault);
    graph.add_dependency(ContractNode::Htlc, ContractNode::CoreVault);
    graph.set_scope(ContractNode::CoreVault, vault_scope());
    graph.set_scope(ContractNode::Htlc, htlc_scope());
    graph
}

#[test]
fn test_graph_is_machine_readable() {
    let env = Env::default();
    let graph = protocol_graph(&env);
    assert_eq!(graph.nodes.len(), 6);
    assert_eq!(graph.dependencies.len(), 5);
    assert!(graph.scope_of(&ContractNode::CoreVault).deposits_blocked);
    // Downstream effects are explicit and queryable.
    assert!(graph.scope_of(&ContractNode::Htlc).claims_open);
    assert!(!graph.scope_of(&ContractNode::Htlc).withdrawals_open);
}

#[test]
fn test_pause_order_is_downstream_first() {
    let env = Env::default();
    let graph = protocol_graph(&env);
    let targets = vec![
        &env,
        ContractNode::UnifiedAuth,
        ContractNode::CoreVault,
        ContractNode::FlashLoanGuard,
        ContractNode::LiquidityVault,
    ];
    let order = plan_propagation_order(&env, &graph, &targets, PropagationDirection::Pause)
        .expect("acyclic graph orders fine");

    // Every dependent (FlashLoanGuard, LiquidityVault) must appear before
    // CoreVault; CoreVault before UnifiedAuth.
    let idx = |n: ContractNode| {
        let mut found = graph.nodes.len();
        for (i, x) in order.iter().enumerate() {
            if x == n {
                found = i as u32;
            }
        }
        found
    };
    assert!(idx(ContractNode::FlashLoanGuard) < idx(ContractNode::CoreVault));
    assert!(idx(ContractNode::LiquidityVault) < idx(ContractNode::CoreVault));
    assert!(idx(ContractNode::CoreVault) < idx(ContractNode::UnifiedAuth));
}

#[test]
fn test_unpause_order_is_upstream_first() {
    let env = Env::default();
    let graph = protocol_graph(&env);
    let targets = vec![
        &env,
        ContractNode::UnifiedAuth,
        ContractNode::CoreVault,
        ContractNode::FlashLoanGuard,
        ContractNode::LiquidityVault,
        ContractNode::Htlc,
    ];
    let order = plan_propagation_order(&env, &graph, &targets, PropagationDirection::Unpause)
        .expect("acyclic graph orders fine");

    let idx = |n: ContractNode| {
        let mut found = graph.nodes.len();
        for (i, x) in order.iter().enumerate() {
            if x == n {
                found = i as u32;
            }
        }
        found
    };
    // Providers come first on unpause.
    assert!(idx(ContractNode::UnifiedAuth) < idx(ContractNode::CoreVault));
    assert!(idx(ContractNode::CoreVault) < idx(ContractNode::FlashLoanGuard));
    assert!(idx(ContractNode::CoreVault) < idx(ContractNode::Htlc));
}

#[test]
fn test_cycle_cannot_be_ordered() {
    let env = Env::default();
    let mut graph = PauseDependencyGraph::new(&env);
    graph.add_dependency(ContractNode::CoreVault, ContractNode::UnifiedAuth);
    graph.add_dependency(ContractNode::UnifiedAuth, ContractNode::CoreVault);
    let targets = vec![
        &env,
        ContractNode::CoreVault,
        ContractNode::UnifiedAuth,
    ];
    // A cycle means propagation cannot be safely ordered (not atomic).
    assert!(plan_propagation_order(&env, &graph, &targets, PropagationDirection::Pause).is_none());
    assert!(plan_propagation_order(&env, &graph, &targets, PropagationDirection::Unpause).is_none());
}

#[test]
fn test_partial_pause_failure_is_detected() {
    let env = Env::default();
    let graph = protocol_graph(&env);

    // Simulate a partial failure: CoreVault (provider) got paused but its
    // dependent FlashLoanGuard did NOT (remains active). This is the unsafe
    // partial-availability state the issue describes.
    let paused_fn = |node: &ContractNode| *node == ContractNode::CoreVault;

    let inconsistent = inconsistent_nodes(&env, &graph, &paused_fn);
    assert!(contains(&inconsistent, &ContractNode::FlashLoanGuard));
    assert!(contains(&inconsistent, &ContractNode::LiquidityVault));
    // Htlc also depends on CoreVault and is active -> inconsistent.
    assert!(contains(&inconsistent, &ContractNode::Htlc));
}

#[test]
fn test_fully_propagated_pause_has_no_inconsistencies() {
    let env = Env::default();
    let graph = protocol_graph(&env);

    // A correctly propagated pause of the CoreVault subtree pauses CoreVault
    // AND all its dependents.
    let paused_fn = |node: &ContractNode| {
        matches!(
            node,
            ContractNode::CoreVault
                | ContractNode::FlashLoanGuard
                | ContractNode::MultiHopSwap
                | ContractNode::LiquidityVault
                | ContractNode::Htlc
        )
    };

    let inconsistent = inconsistent_nodes(&env, &graph, &paused_fn);
    assert_eq!(inconsistent.len(), 0);
}

#[test]
fn test_user_exits_remain_available_when_scope_allows() {
    let env = Env::default();
    let graph = protocol_graph(&env);

    // CoreVault keeps withdrawals open while paused -> exits available.
    assert!(user_exits_available(&graph, &ContractNode::CoreVault));
    // Htlc keeps claims open while paused -> exits available.
    assert!(user_exits_available(&graph, &ContractNode::Htlc));
    // A node whose scope blocks both withdrawals and claims traps funds.
    let mut blocked = graph.clone();
    blocked.set_scope(
        ContractNode::MultiHopSwap,
        PauseScope {
            deposits_blocked: true,
            withdrawals_open: false,
            claims_open: false,
            strategy_allocation_blocked: false,
            oracle_ops_blocked: true,
            flips_backend: false,
        },
    );
    assert!(!user_exits_available(&blocked, &ContractNode::MultiHopSwap));
}

#[test]
fn test_unpause_propagation_avoids_active_dependent_against_paused_provider() {
    let env = Env::default();
    let graph = protocol_graph(&env);

    // Start fully paused (CoreVault subtree + provider reachable).
    let mut paused_map: Map<ContractNode, bool> = Map::new(&env);
    for n in graph.nodes.iter() {
        paused_map.set(n.clone(), true);
    }

    // Unpause order says UnifiedAuth first, then CoreVault, then dependents.
    let mut targets = Vec::new(&env);
    for n in graph.nodes.iter() {
        targets.push_back(n);
    }
    let order = plan_propagation_order(&env, &graph, &targets, PropagationDirection::Unpause)
        .expect("orderable");

    // Simulate applying the order; after each step the remaining paused
    // nodes must never include a paused provider with an active dependent —
    // i.e. inconsistent set stays empty as long as we follow the order.
    let mut final_all_unpaused = true;
    for node in order.iter() {
        paused_map.set(node.clone(), false);
        let inconsistent = inconsistent_nodes(
            &env,
            &graph,
            &|n: &ContractNode| paused_map.get(n.clone()).unwrap_or(false),
        );
        // Following the correct order must not produce an inconsistency at
        // any step along the way (unpause is partial-failure-safe).
        assert_eq!(inconsistent.len(), 0, "unpause step {:?} introduced inconsistency", node);
    }
    for n in graph.nodes.iter() {
        if paused_map.get(n.clone()).unwrap_or(false) {
            final_all_unpaused = false;
        }
    }
    assert!(final_all_unpaused);
}
