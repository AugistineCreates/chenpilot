#![cfg(test)]

//! Differential state-machine fuzzer for Fee Distribution contract against an independent reference model.

use super::*;
use diff_fuzz_engine::{
    run_fuzz_campaign, DeterministicPrng, DifferentialStateMachine, FuzzConfig, LedgerSnapshot,
};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

const PRECISION: i128 = 1_000_000_000_000;
const MAX_DUST_TOLERANCE: i128 = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FeeOp {
    Stake { user_idx: usize, amount: i128 },
    Unstake { user_idx: usize, amount: i128 },
    Distribute { amount: i128 },
    Claim { user_idx: usize },
    UpdateConfig { treasury_bps: u32, ai_agent_bps: u32 },
}

#[derive(Clone, Debug, Default)]
pub struct RefStaker {
    pub shares: i128,
    pub reward_index: i128,
    pub pending: i128,
    pub total_claimed: i128,
}

#[derive(Clone, Debug)]
pub struct FeeReferenceModel {
    pub treasury_bps: u32,
    pub ai_agent_bps: u32,
    pub total_shares: i128,
    pub global_reward_index: i128,
    pub stakers: HashMap<usize, RefStaker>,
    pub pool_balance: i128,
    pub treasury_received: i128,
    pub ai_agent_received: i128,
    pub total_lp_allocated: i128,
}

impl FeeReferenceModel {
    fn settle_user(&mut self, user_idx: usize) {
        let global_idx = self.global_reward_index;
        let staker = self.stakers.entry(user_idx).or_default();
        let delta = global_idx.saturating_sub(staker.reward_index);
        let accrued = staker
            .shares
            .checked_mul(delta)
            .and_then(|n| n.checked_div(PRECISION))
            .unwrap_or(0);
        staker.pending = staker.pending.saturating_add(accrued);
        staker.reward_index = global_idx;
    }
}

pub struct FeeContractHarness {
    pub env: Env,
    pub client: FeeDistributionContractClient<'static>,
    pub token_client: token::Client<'static>,
    pub token_sa: token::StellarAssetClient<'static>,
    pub token_addr: Address,
    pub admin: Address,
    pub treasury: Address,
    pub ai_agent_pool: Address,
    pub lp_pool: Address,
    pub fee_payer: Address,
    pub users: Vec<Address>,
}

pub struct FeeStateMachine;

impl DifferentialStateMachine for FeeStateMachine {
    type Op = FeeOp;
    type Model = FeeReferenceModel;
    type ContractHarness = FeeContractHarness;

    fn name(&self) -> &'static str {
        "FeeDistribution"
    }

    fn setup(&self, _prng: &mut DeterministicPrng) -> (Self::Model, Self::ContractHarness) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let ai_agent_pool = Address::generate(&env);
        let lp_pool = Address::generate(&env);
        let fee_payer = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
        let token_client = token::Client::new(&env, &token_addr);
        let token_sa = token::StellarAssetClient::new(&env, &token_addr);

        let contract_id = env.register_contract(None, FeeDistributionContract);
        let client = FeeDistributionContractClient::new(&env, &contract_id);

        let treasury_bps = 2_000u32;
        let ai_agent_bps = 1_000u32;
        client.initialize(&admin, &treasury, &ai_agent_pool, &lp_pool, &treasury_bps, &ai_agent_bps);

        let mut users = Vec::new();
        for _ in 0..3 {
            let u = Address::generate(&env);
            token_sa.mint(&u, &100_000_000);
            users.push(u);
        }
        token_sa.mint(&fee_payer, &100_000_000);

        let client = unsafe {
            std::mem::transmute::<FeeDistributionContractClient<'_>, FeeDistributionContractClient<'static>>(
                client,
            )
        };
        let token_client = unsafe {
            std::mem::transmute::<token::Client<'_>, token::Client<'static>>(token_client)
        };
        let token_sa = unsafe {
            std::mem::transmute::<token::StellarAssetClient<'_>, token::StellarAssetClient<'static>>(token_sa)
        };

        let model = FeeReferenceModel {
            treasury_bps,
            ai_agent_bps,
            total_shares: 0,
            global_reward_index: 0,
            stakers: HashMap::new(),
            pool_balance: 0,
            treasury_received: 0,
            ai_agent_received: 0,
            total_lp_allocated: 0,
        };

        let harness = FeeContractHarness {
            env,
            client,
            token_client,
            token_sa,
            token_addr,
            admin,
            treasury,
            ai_agent_pool,
            lp_pool,
            fee_payer,
            users,
        };

        (model, harness)
    }

    fn generate_op(&self, prng: &mut DeterministicPrng, _model: &Self::Model) -> Self::Op {
        match prng.gen_range_u64(0, 4) {
            0 => FeeOp::Stake {
                user_idx: prng.gen_range_usize(0, 2),
                amount: prng.gen_range_i128(100, 10_000),
            },
            1 => FeeOp::Unstake {
                user_idx: prng.gen_range_usize(0, 2),
                amount: prng.gen_range_i128(100, 10_000),
            },
            2 => FeeOp::Distribute {
                amount: prng.gen_range_i128(500, 50_000),
            },
            3 => FeeOp::Claim {
                user_idx: prng.gen_range_usize(0, 2),
            },
            _ => FeeOp::UpdateConfig {
                treasury_bps: prng.gen_range_u64(500, 2500) as u32,
                ai_agent_bps: prng.gen_range_u64(500, 2500) as u32,
            },
        }
    }

    fn apply_model(&self, model: &mut Self::Model, op: &Self::Op) -> Result<String, String> {
        match op {
            FeeOp::Stake { user_idx, amount } => {
                if *amount <= 0 {
                    return Err("AmountNotPositive".to_string());
                }
                model.settle_user(*user_idx);
                let staker = model.stakers.get_mut(user_idx).unwrap();
                staker.shares += *amount;
                model.total_shares += *amount;
                Ok(format!("staked_shares={}", staker.shares))
            }
            FeeOp::Unstake { user_idx, amount } => {
                if *amount <= 0 {
                    return Err("AmountNotPositive".to_string());
                }
                model.settle_user(*user_idx);
                let staker = model.stakers.get_mut(user_idx).unwrap();
                if *amount > staker.shares {
                    return Err("InsufficientShares".to_string());
                }
                staker.shares -= *amount;
                model.total_shares -= *amount;
                Ok(format!("remaining_shares={}", staker.shares))
            }
            FeeOp::Distribute { amount } => {
                if *amount <= 0 {
                    return Err("AmountNotPositive".to_string());
                }
                let t_share = amount * model.treasury_bps as i128 / 10_000;
                let a_share = amount * model.ai_agent_bps as i128 / 10_000;
                let lp_share = amount - t_share - a_share;

                model.treasury_received += t_share;
                model.ai_agent_received += a_share;
                model.pool_balance += lp_share;
                model.total_lp_allocated += lp_share;

                if model.total_shares > 0 && lp_share > 0 {
                    let increment = lp_share
                        .checked_mul(PRECISION)
                        .unwrap()
                        .checked_div(model.total_shares)
                        .unwrap();
                    model.global_reward_index += increment;
                }

                Ok(format!("distributed_lp={}", lp_share))
            }
            FeeOp::Claim { user_idx } => {
                model.settle_user(*user_idx);
                let staker = model.stakers.get_mut(user_idx).unwrap();
                let payout = staker.pending;
                staker.pending = 0;
                staker.total_claimed += payout;
                model.pool_balance -= payout;
                Ok(format!("claimed={}", payout))
            }
            FeeOp::UpdateConfig { treasury_bps, ai_agent_bps } => {
                if *treasury_bps + *ai_agent_bps > 10_000 {
                    return Err("InvalidBasisPoints".to_string());
                }
                model.treasury_bps = *treasury_bps;
                model.ai_agent_bps = *ai_agent_bps;
                Ok("config_updated".to_string())
            }
        }
    }

    fn apply_contract(&self, harness: &mut Self::ContractHarness, op: &Self::Op) -> Result<String, String> {
        let client = &harness.client;
        let token_addr = &harness.token_addr;
        let users = &harness.users;

        match op {
            FeeOp::Stake { user_idx, amount } => {
                let user = &users[*user_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.stake(token_addr, user, amount)
                }));
                res.map(|shares| format!("staked_shares={}", shares))
                    .map_err(|_| "ContractReverted".to_string())
            }
            FeeOp::Unstake { user_idx, amount } => {
                let user = &users[*user_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.unstake(token_addr, user, amount)
                }));
                res.map(|shares| format!("remaining_shares={}", shares))
                    .map_err(|_| "ContractReverted".to_string())
            }
            FeeOp::Distribute { amount } => {
                let from = &harness.fee_payer;
                let res = catch_unwind(AssertUnwindSafe(|| {
                    let record = client.distribute(token_addr, from, amount);
                    record.lp_share
                }));
                res.map(|lp| format!("distributed_lp={}", lp))
                    .map_err(|_| "ContractReverted".to_string())
            }
            FeeOp::Claim { user_idx } => {
                let user = &users[*user_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.claim(token_addr, user)
                }));
                res.map(|claimed| format!("claimed={}", claimed))
                    .map_err(|_| "ContractReverted".to_string())
            }
            FeeOp::UpdateConfig { treasury_bps, ai_agent_bps } => {
                let current = client.get_config();
                let cfg = Config {
                    admin: current.admin,
                    treasury: current.treasury,
                    ai_agent_pool: current.ai_agent_pool,
                    lp_pool: current.lp_pool,
                    treasury_bps: *treasury_bps,
                    ai_agent_bps: *ai_agent_bps,
                };
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.update_config(&cfg);
                }));
                res.map(|_| "config_updated".to_string())
                    .map_err(|_| "ContractReverted".to_string())
            }
        }
    }

    fn assert_invariants(&self, model: &Self::Model, harness: &Self::ContractHarness, _op: &Self::Op) -> Result<(), String> {
        let client = &harness.client;
        let token_addr = &harness.token_addr;

        // Invariant 1: Total shares exact match
        let rewards = client.get_rewards(token_addr);
        if rewards.total_shares != model.total_shares {
            return Err(format!("Total shares mismatch: model={}, contract={}", model.total_shares, rewards.total_shares));
        }

        // Invariant 2: Per-user shares and pending rewards match within bounded dust
        for (i, user) in harness.users.iter().enumerate() {
            let u_contract = client.get_user(token_addr, user);
            let u_model = model.stakers.get(&i).cloned().unwrap_or_default();

            if u_contract.shares != u_model.shares {
                return Err(format!("User {} shares mismatch: model={}, contract={}", i, u_model.shares, u_contract.shares));
            }

            let pending_contract = client.pending_rewards(token_addr, user);
            let expected_pending = {
                let delta = model.global_reward_index.saturating_sub(u_model.reward_index);
                let accrued = u_model.shares.checked_mul(delta).and_then(|n| n.checked_div(PRECISION)).unwrap_or(0);
                u_model.pending + accrued
            };

            let diff = (pending_contract - expected_pending).abs();
            if diff > MAX_DUST_TOLERANCE {
                return Err(format!("User {} pending rewards diverged by {}: contract={}, model={}", i, diff, pending_contract, expected_pending));
            }
        }

        // Invariant 3: Solvency (contract holds at least total_shares + remaining pool balance within dust)
        let contract_bal = harness.token_client.balance(&harness.client.address);
        let expected_min_bal = model.total_shares + model.pool_balance - MAX_DUST_TOLERANCE * 3;
        if contract_bal < expected_min_bal {
            return Err(format!("Solvency violated: contract balance {} is less than expected minimum {}", contract_bal, expected_min_bal));
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
            "TotalShares: {}, RewardIndex: {}, PoolBal: {}, TreasuryRecv: {}, AiAgentRecv: {}",
            model.total_shares, model.global_reward_index, model.pool_balance, model.treasury_received, model.ai_agent_received
        )
    }

    fn format_contract_state(&self, harness: &Self::ContractHarness) -> String {
        let rewards = harness.client.get_rewards(&harness.token_addr);
        format!(
            "TotalShares: {}, RewardIndex: {}, ContractTokenBal: {}",
            rewards.total_shares, rewards.reward_index, harness.token_client.balance(&harness.client.address)
        )
    }
}

#[test]
fn test_fee_differential_fuzzing() {
    let config = FuzzConfig::default();
    run_fuzz_campaign(&FeeStateMachine, &config, 0xFEE_0001);
}
