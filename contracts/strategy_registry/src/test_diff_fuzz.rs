#![cfg(test)]

//! Differential state-machine fuzzer for Strategy Registry contract against an independent reference model.

use super::*;
use diff_fuzz_engine::{
    run_fuzz_campaign, DeterministicPrng, DifferentialStateMachine, FuzzConfig, LedgerSnapshot,
};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env};
use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StrategyOp {
    SetAiAgent { agent_idx: usize, authorized: bool },
    AddVerifiedPool { pool_idx: usize },
    RemoveVerifiedPool { pool_idx: usize },
    VoteStrategy { agent_idx: usize, pool_idx: usize },
    AdvanceLedger(u32),
}

#[derive(Clone, Debug)]
pub struct StrategyRegistryReferenceModel {
    pub authorized_agents: HashSet<usize>,
    pub verified_pools: HashMap<usize, u32>, // pool_idx -> added_ledger
    pub pool_votes: HashMap<usize, u32>,
    pub voted_pools_order: Vec<usize>,
    pub current_strategy: Option<usize>,
    pub current_ledger: u32,
}

pub struct StrategyContractHarness {
    pub env: Env,
    pub client: StrategyRegistryContractClient<'static>,
    pub admin: Address,
    pub agents: Vec<Address>,
    pub pool_ids: Vec<BytesN<32>>,
}

pub struct StrategyStateMachine;

impl DifferentialStateMachine for StrategyStateMachine {
    type Op = StrategyOp;
    type Model = StrategyRegistryReferenceModel;
    type ContractHarness = StrategyContractHarness;

    fn name(&self) -> &'static str {
        "StrategyRegistry"
    }

    fn setup(&self, _prng: &mut DeterministicPrng) -> (Self::Model, Self::ContractHarness) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(1_000);

        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, StrategyRegistryContract);
        let client = StrategyRegistryContractClient::new(&env, &contract_id);
        client.init(&admin);

        let mut agents = Vec::new();
        for _ in 0..4 {
            agents.push(Address::generate(&env));
        }

        let mut pool_ids = Vec::new();
        for i in 1..=4u8 {
            let mut arr = [0u8; 32];
            arr[0] = i;
            pool_ids.push(BytesN::from_array(&env, &arr));
        }

        let client = unsafe {
            std::mem::transmute::<StrategyRegistryContractClient<'_>, StrategyRegistryContractClient<'static>>(
                client,
            )
        };

        let model = StrategyRegistryReferenceModel {
            authorized_agents: HashSet::new(),
            verified_pools: HashMap::new(),
            pool_votes: HashMap::new(),
            voted_pools_order: Vec::new(),
            current_strategy: None,
            current_ledger: 1_000,
        };

        let harness = StrategyContractHarness {
            env,
            client,
            admin,
            agents,
            pool_ids,
        };

        (model, harness)
    }

    fn generate_op(&self, prng: &mut DeterministicPrng, _model: &Self::Model) -> Self::Op {
        match prng.gen_range_u64(0, 4) {
            0 => StrategyOp::SetAiAgent {
                agent_idx: prng.gen_range_usize(0, 3),
                authorized: prng.gen_bool(),
            },
            1 => StrategyOp::AddVerifiedPool {
                pool_idx: prng.gen_range_usize(0, 3),
            },
            2 => StrategyOp::RemoveVerifiedPool {
                pool_idx: prng.gen_range_usize(0, 3),
            },
            3 => StrategyOp::VoteStrategy {
                agent_idx: prng.gen_range_usize(0, 3),
                pool_idx: prng.gen_range_usize(0, 3),
            },
            _ => StrategyOp::AdvanceLedger(prng.gen_range_u64(1, 50) as u32),
        }
    }

    fn apply_model(&self, model: &mut Self::Model, op: &Self::Op) -> Result<String, String> {
        match op {
            StrategyOp::SetAiAgent { agent_idx, authorized } => {
                if *authorized {
                    model.authorized_agents.insert(*agent_idx);
                } else {
                    model.authorized_agents.remove(agent_idx);
                }
                Ok(format!("agent_{}_auth={}", agent_idx, authorized))
            }
            StrategyOp::AddVerifiedPool { pool_idx } => {
                model.verified_pools.insert(*pool_idx, model.current_ledger);
                Ok(format!("pool_{}_verified_at={}", pool_idx, model.current_ledger))
            }
            StrategyOp::RemoveVerifiedPool { pool_idx } => {
                model.verified_pools.remove(pool_idx);
                Ok(format!("pool_{}_removed", pool_idx))
            }
            StrategyOp::VoteStrategy { agent_idx, pool_idx } => {
                if !model.authorized_agents.contains(agent_idx) {
                    return Err("AiAgentNotAuthorized".to_string());
                }
                if !model.verified_pools.contains_key(pool_idx) {
                    return Err("PoolNotVerified".to_string());
                }

                let votes = model.pool_votes.entry(*pool_idx).or_insert(0);
                *votes += 1;

                if !model.voted_pools_order.contains(pool_idx) {
                    model.voted_pools_order.push(*pool_idx);
                }

                let mut max_votes = 0;
                let mut best_pool = *pool_idx;
                for p in &model.voted_pools_order {
                    let p_votes = model.pool_votes.get(p).copied().unwrap_or(0);
                    if p_votes > max_votes {
                        max_votes = p_votes;
                        best_pool = *p;
                    }
                }
                model.current_strategy = Some(best_pool);

                Ok(format!("vote_cast_best_pool={}", best_pool))
            }
            StrategyOp::AdvanceLedger(delta) => {
                model.current_ledger += delta;
                Ok(format!("ledger_at={}", model.current_ledger))
            }
        }
    }

    fn apply_contract(&self, harness: &mut Self::ContractHarness, op: &Self::Op) -> Result<String, String> {
        let client = &harness.client;
        let agents = &harness.agents;
        let pool_ids = &harness.pool_ids;

        match op {
            StrategyOp::SetAiAgent { agent_idx, authorized } => {
                let agent = &agents[*agent_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.set_ai_agent(agent, authorized);
                }));
                res.map(|_| format!("agent_{}_auth={}", agent_idx, authorized))
                    .map_err(|_| "ContractReverted".to_string())
            }
            StrategyOp::AddVerifiedPool { pool_idx } => {
                let pool = &pool_ids[*pool_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.add_verified_pool(pool);
                }));
                res.map(|_| format!("pool_{}_verified_at={}", pool_idx, harness.env.ledger().sequence()))
                    .map_err(|_| "ContractReverted".to_string())
            }
            StrategyOp::RemoveVerifiedPool { pool_idx } => {
                let pool = &pool_ids[*pool_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.remove_verified_pool(pool);
                }));
                res.map(|_| format!("pool_{}_removed", pool_idx))
                    .map_err(|_| "ContractReverted".to_string())
            }
            StrategyOp::VoteStrategy { agent_idx, pool_idx } => {
                let agent = &agents[*agent_idx];
                let pool = &pool_ids[*pool_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.vote_strategy(agent, pool);
                    client.get_current_strategy().unwrap()
                }));
                res.map(|best| {
                    let best_idx = pool_ids.iter().position(|p| p == &best).unwrap_or(99);
                    format!("vote_cast_best_pool={}", best_idx)
                })
                .map_err(|_| "ContractReverted".to_string())
            }
            StrategyOp::AdvanceLedger(delta) => {
                let s = harness.env.ledger().sequence() + delta;
                harness.env.ledger().set_sequence_number(s);
                Ok(format!("ledger_at={}", s))
            }
        }
    }

    fn assert_invariants(&self, model: &Self::Model, harness: &Self::ContractHarness, _op: &Self::Op) -> Result<(), String> {
        let client = &harness.client;

        // Invariant 1: Verified pool status matches reference model
        for (i, pool_id) in harness.pool_ids.iter().enumerate() {
            let m_verified = model.verified_pools.contains_key(&i);
            let c_verified = client.is_pool_verified(pool_id);
            if m_verified != c_verified {
                return Err(format!("Pool {} verification status mismatch: model={}, contract={}", i, m_verified, c_verified));
            }
        }

        // Invariant 2: Current strategy matches reference model winner
        let c_current = client.get_current_strategy();
        match (model.current_strategy, c_current) {
            (Some(m_best), Some(c_best)) => {
                let m_pool = &harness.pool_ids[m_best];
                if m_pool != &c_best {
                    return Err(format!("Current strategy mismatch: model=pool_{}, contract={:?}", m_best, c_best));
                }
            }
            (None, None) => {}
            (m, c) => return Err(format!("Current strategy existence mismatch: model={:?}, contract={:?}", m, c.is_some())),
        }

        Ok(())
    }

    fn ledger_state(&self, harness: &Self::ContractHarness) -> LedgerSnapshot {
        LedgerSnapshot {
            sequence: harness.env.ledger().sequence(),
            timestamp: harness.env.ledger().timestamp(),
        }
    }

    fn format_model_state(&self, model: &Self::Model) -> String {
        format!(
            "AuthorizedAgents: {:?}, VerifiedPools: {:?}, Votes: {:?}, Best: {:?}",
            model.authorized_agents, model.verified_pools, model.pool_votes, model.current_strategy
        )
    }

    fn format_contract_state(&self, harness: &Self::ContractHarness) -> String {
        format!(
            "CurrentStrategy: {:?}",
            harness.client.get_current_strategy()
        )
    }
}

#[test]
fn test_strategy_differential_fuzzing() {
    let config = FuzzConfig::default();
    run_fuzz_campaign(&StrategyStateMachine, &config, 0x578A_7E61);
}
