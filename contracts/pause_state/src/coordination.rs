//! Protocol-wide pause coordination for dependent contracts (Issue #672).
//!
//! The base `pause_state` standard (this crate's root module) provides the
//! per-contract pause flag. This submodule layers a *protocol-wide* view on top
//! of it:
//!
//! - a **machine-readable pause dependency graph** (`PauseDependencyGraph`)
//!   describing which contracts depend on which, plus a per-contract
//!   `PauseScope` that says exactly which operations are blocked and which
//!   user exits remain open when paused,
//! - **propagation rules** that order pause (downstream-first) and unpause
//!   (upstream-first) so emergency actions are atomic or safely ordered,
//! - **partial-failure detection** (`inconsistent_nodes`) that flags the exact
//!   unsafe state the issue calls out — a dependent contract left active while
//!   its provider is paused, which can create partial availability or trap
//!   funds,
//! - **withdrawal-safe degraded modes** (`user_exits_available`) so user exits
//!   stay reachable whenever protocol invariants permit.
//!
//! Like the root module, this submodule is deliberately `#![no_std]`, owns no
//! authorization, and does NOT depend on `contract_failure` (whose
//! `FailureReason` is broken past Soroban's 50-case `#[contracterror]` limit),
//! so it stays independently compilable and testable.
//!
//! ## Propagation invariant
//!
//! For every dependency edge `A -> B` (A depends on B; B is upstream):
//!
//! - **Pause** is applied downstream-first: every dependent of a provider must
//!   be paused *before* the provider is paused. Pausing a provider while a
//!   dependent remains active is an *inconsistency*.
//! - **Unpause** is applied upstream-first: a provider must be unpaused *before*
//!   its dependents, so a dependent never resumes operating against a still
//!   paused provider.
//!
//! `inconsistent_nodes` reports any node that violates the pause invariant, so
//! a partial failure during propagation is detectable and revertable.

use soroban_sdk::{contracttype, Env, Map, Vec};

/// Machine-readable identifier for a contract participating in the pause
/// dependency graph.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ContractNode {
    UnifiedAuth,
    CoreVault,
    LiquidityVault,
    FlashLoanGuard,
    Htlc,
    FeeDistribution,
    RelayerSlashing,
    MultiHopSwap,
    LendingLiquidation,
    BtcRelay,
    StrategyRegistry,
    StrategyBoundary,
}

/// Machine-readable scope of a pause for a single contract: which operations
/// are blocked and which user exits remain open (Issue #672 acceptance:
/// "Pause scope and downstream effects are machine-readable").
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PauseScope {
    /// Inbound deposits / new exposure are blocked while paused.
    pub deposits_blocked: bool,
    /// User withdrawals remain available while paused (no trapped funds).
    pub withdrawals_open: bool,
    /// User claims (e.g. HTLC refund/claim, fee claims) remain available.
    pub claims_open: bool,
    /// Strategy allocation is frozen while paused.
    pub strategy_allocation_blocked: bool,
    /// Oracle-dependent operations are blocked while paused.
    pub oracle_ops_blocked: bool,
    /// Contract flips backend/availability requiring ordered propagation.
    pub flips_backend: bool,
}

/// Directed dependency edge: `from` depends on `to` (i.e. `to` is upstream of
/// `from`). Pausing `to` must be preceded by pausing `from` (downstream).
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PauseDependency {
    pub from: ContractNode,
    pub to: ContractNode,
}

/// The full, machine-readable pause dependency graph.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseDependencyGraph {
    pub nodes: Vec<ContractNode>,
    pub dependencies: Vec<PauseDependency>,
    pub scopes: Map<ContractNode, PauseScope>,
}

impl PauseDependencyGraph {
    /// A new, empty graph (structure only; the Soroban `Env` is passed by the
    /// caller for container allocation).
    pub fn new(env: &Env) -> Self {
        PauseDependencyGraph {
            nodes: Vec::new(env),
            dependencies: Vec::new(env),
            scopes: Map::new(env),
        }
    }

    /// The scope recorded for a node, defaulting to a no-op scope (no
    /// operations blocked, exits open).
    pub fn scope_of(&self, node: &ContractNode) -> PauseScope {
        self.scopes.get(node.clone()).unwrap_or(PauseScope {
            deposits_blocked: false,
            withdrawals_open: true,
            claims_open: true,
            strategy_allocation_blocked: false,
            oracle_ops_blocked: false,
            flips_backend: false,
        })
    }

    /// Direct dependents of a node (nodes that list `node` as upstream).
    pub fn dependents(&self, env: &Env, node: &ContractNode) -> Vec<ContractNode> {
        let mut out = Vec::new(env);
        for edge in self.dependencies.iter() {
            if &edge.to == node && !contains(&out, &edge.from) {
                out.push_back(edge.from.clone());
            }
        }
        out
    }

    /// Direct providers (upstream nodes) that `node` depends on.
    pub fn providers(&self, env: &Env, node: &ContractNode) -> Vec<ContractNode> {
        let mut out = Vec::new(env);
        for edge in self.dependencies.iter() {
            if &edge.from == node && !contains(&out, &edge.to) {
                out.push_back(edge.to.clone());
            }
        }
        out
    }

    /// Add a node to the graph even if it has no edges (so it can appear in a
    /// propagation order).
    pub fn add_node(&mut self, node: ContractNode) {
        if !contains(&self.nodes, &node) {
            self.nodes.push_back(node);
        }
    }

    /// Add a dependency edge `from -> to`, de-duplicating and ensuring both
    /// endpoints are recorded as nodes.
    pub fn add_dependency(&mut self, from: ContractNode, to: ContractNode) {
        self.add_node(from.clone());
        self.add_node(to.clone());
        for edge in self.dependencies.iter() {
            if &edge.from == &from && &edge.to == &to {
                return;
            }
        }
        self.dependencies.push_back(PauseDependency { from, to });
    }

    /// Set the machine-readable scope for a node.
    pub fn set_scope(&mut self, node: ContractNode, scope: PauseScope) {
        self.add_node(node.clone());
        self.scopes.set(node, scope);
    }
}

fn contains(nodes: &Vec<ContractNode>, node: &ContractNode) -> bool {
    for n in nodes.iter() {
        if &n == node {
            return true;
        }
    }
    false
}

/// Order in which to pause/resume a set of nodes given a dependency graph.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PropagationDirection {
    /// Pause: downstream (dependents) first, then upstream (providers).
    Pause,
    /// Unpause: upstream (providers) first, then downstream (dependents).
    Unpause,
}

/// Compute a safe propagation order for the nodes in the graph. `targets` is
/// the set of nodes the emergency action intends to touch.
///
/// - `Pause` returns a downstream-first order: every dependent is ordered
///   before its provider, so pausing the provider never leaves an active
///   dependent.
/// - `Unpause` returns an upstream-first order: every provider is ordered
///   before its dependents.
///
/// Returns `None` if the graph contains a cycle (propagation can never be
/// safely ordered for a cycle).
pub fn plan_propagation_order(
    env: &Env,
    graph: &PauseDependencyGraph,
    targets: &Vec<ContractNode>,
    direction: PropagationDirection,
) -> Option<Vec<ContractNode>> {
    let mut remaining: Vec<ContractNode> = Vec::new(env);
    let mut emitted: Vec<ContractNode> = Vec::new(env);
    for node in graph.nodes.iter() {
        remaining.push_back(node.clone());
    }

    let mut order: Vec<ContractNode> = Vec::new(env);
    while !remaining.is_empty() {
        let len = remaining.len();
        let mut candidate_index: Option<u32> = None;
        let mut i = 0u32;
        while i < len {
            let node = remaining.get(i).unwrap();
            let ready = match direction {
                PropagationDirection::Pause => {
                    // Ready when all dependents are already emitted.
                    let dependents = graph.dependents(env, &node);
                    let mut all_done = true;
                    for dep in dependents.iter() {
                        if !contains(&emitted, &dep) {
                            all_done = false;
                            break;
                        }
                    }
                    all_done
                }
                PropagationDirection::Unpause => {
                    // Ready when all providers are already emitted.
                    let providers = graph.providers(env, &node);
                    let mut all_done = true;
                    for prov in providers.iter() {
                        if !contains(&emitted, &prov) {
                            all_done = false;
                            break;
                        }
                    }
                    all_done
                }
            };
            if ready {
                candidate_index = Some(i);
                break;
            }
            i += 1;
        }

        let candidate_index = match candidate_index {
            Some(ix) => ix,
            None => return None, // cycle — cannot safely order propagation
        };
        let node = remaining.get(candidate_index).unwrap().clone();
        order.push_back(node.clone());
        emitted.push_back(node.clone());

        let mut next = Vec::new(env);
        for (j, n) in remaining.iter().enumerate() {
            if (j as u32) != candidate_index {
                next.push_back(n.clone());
            }
        }
        remaining = next;
    }

    // Restrict to the requested targets, preserving the computed order.
    let mut result = Vec::new(env);
    for node in order.iter() {
        if contains(targets, &node) {
            result.push_back(node.clone());
        }
    }
    Some(result)
}

/// Detect partial failures during propagation (Issue #672 acceptance: "Tests
/// cover partial failure during pause and unpause propagation").
///
/// `is_paused(node)` returns the *actual* pause state of the node. A node is
/// **inconsistent** when a provider (upstream) is paused but one of its
/// dependents is still active — the exact unsafe partial-availability /
/// trapped-funds situation. Returns the offending dependents.
pub fn inconsistent_nodes(
    env: &Env,
    graph: &PauseDependencyGraph,
    is_paused: &dyn Fn(&ContractNode) -> bool,
) -> Vec<ContractNode> {
    let mut out = Vec::new(env);
    for edge in graph.dependencies.iter() {
        // edge.from depends on edge.to (upstream). If upstream is paused but
        // the dependent is active -> inconsistent.
        if is_paused(&edge.to) && !is_paused(&edge.from) {
            if !contains(&out, &edge.from) {
                out.push_back(edge.from.clone());
            }
        }
    }
    out
}

/// Whether user exits remain available for a paused contract, given its
/// machine-readable scope (Issue #672 acceptance: "User exits remain available
/// whenever protocol invariants permit"). A node with neither withdrawals nor
/// claims open would trap funds; that is only acceptable when the scope
/// explicitly blocks both, and is surfaced here so callers can decide.
pub fn user_exits_available(graph: &PauseDependencyGraph, node: &ContractNode) -> bool {
    let scope = graph.scope_of(node);
    scope.withdrawals_open || scope.claims_open
}

#[cfg(test)]
mod tests;
