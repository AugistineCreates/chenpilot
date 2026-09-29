#![cfg(test)]

//! Differential state-machine fuzzer for Multi-Hop Swap contract against an independent reference model.

use super::*;
use diff_fuzz_engine::{
    run_fuzz_campaign, DeterministicPrng, DifferentialStateMachine, FuzzConfig, LedgerSnapshot,
};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{
    contract, contractimpl, symbol_short, token::{self, Client as TokenClient}, vec, Address, Env, Vec as SorobanVec,
};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

#[contract]
pub struct DiffMockPool;

#[contractimpl]
impl DiffMockPool {
    pub fn initialize(env: Env, numer: i128, denom: i128) {
        env.storage().instance().set(&symbol_short!("numer"), &numer);
        env.storage().instance().set(&symbol_short!("denom"), &denom);
    }

    pub fn set_rate(env: Env, numer: i128, denom: i128) {
        env.storage().instance().set(&symbol_short!("numer"), &numer);
        env.storage().instance().set(&symbol_short!("denom"), &denom);
    }

    pub fn swap(env: Env, to: Address, _token_in: Address, token_out: Address, amount_in: i128, min_amount_out: i128) -> i128 {
        let numer: i128 = env.storage().instance().get(&symbol_short!("numer")).unwrap_or(1);
        let denom: i128 = env.storage().instance().get(&symbol_short!("denom")).unwrap_or(1);
        let amount_out = amount_in * numer / denom;

        if amount_out < min_amount_out {
            panic!("slippage exceeded");
        }

        TokenClient::new(&env, &token_out).transfer(&env.current_contract_address(), &to, &amount_out);
        amount_out
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HopParam {
    pub pool_idx: usize,
    pub token_in_idx: usize,
    pub token_out_idx: usize,
    pub amount_in: i128,
    pub min_amount_out: i128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SwapOp {
    SetPoolRate { pool_idx: usize, numer: i128, denom: i128 },
    ExecuteSwap { hops: Vec<HopParam> },
    FundUser { token_idx: usize, amount: i128 },
}

#[derive(Clone, Debug)]
pub struct MultiHopSwapReferenceModel {
    pub pool_rates: HashMap<usize, (i128, i128)>, // pool_idx -> (numer, denom)
    pub user_balances: HashMap<usize, i128>,      // token_idx -> balance
    pub last_output: Option<i128>,
}

pub struct SwapContractHarness {
    pub env: Env,
    pub swap_client: MultiHopSwapClient<'static>,
    pub pool_clients: Vec<DiffMockPoolClient<'static>>,
    pub token_clients: Vec<token::Client<'static>>,
    pub token_sa_clients: Vec<token::StellarAssetClient<'static>>,
    pub pool_addrs: Vec<Address>,
    pub token_addrs: Vec<Address>,
    pub caller: Address,
}

pub struct SwapStateMachine;

impl DifferentialStateMachine for SwapStateMachine {
    type Op = SwapOp;
    type Model = MultiHopSwapReferenceModel;
    type ContractHarness = SwapContractHarness;

    fn name(&self) -> &'static str {
        "MultiHopSwap"
    }

    fn setup(&self, _prng: &mut DeterministicPrng) -> (Self::Model, Self::ContractHarness) {
        let env = Env::default();
        env.mock_all_auths();

        let caller = Address::generate(&env);
        let swap_contract_id = env.register_contract(None, MultiHopSwap);
        let swap_client = MultiHopSwapClient::new(&env, &swap_contract_id);

        let mut token_addrs = Vec::new();
        let mut token_clients = Vec::new();
        let mut token_sa_clients = Vec::new();
        for _ in 0..4 {
            let admin = Address::generate(&env);
            let t_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
            let tc = token::Client::new(&env, &t_addr);
            let sa = token::StellarAssetClient::new(&env, &t_addr);
            token_addrs.push(t_addr);
            token_clients.push(tc);
            token_sa_clients.push(sa);
        }

        let mut pool_addrs = Vec::new();
        let mut pool_clients = Vec::new();
        let mut initial_rates = HashMap::new();
        for i in 0..3 {
            let p_addr = env.register_contract(None, DiffMockPool);
            let pc = DiffMockPoolClient::new(&env, &p_addr);
            pc.initialize(&1, &1); // initial 1:1
            pool_addrs.push(p_addr.clone());
            pool_clients.push(pc);
            initial_rates.insert(i, (1i128, 1i128));

            // Mint deep reserve to pool so it can pay out any swap
            for sa in &token_sa_clients {
                sa.mint(&p_addr, &1_000_000_000);
            }
        }

        // Fund caller initially
        for sa in &token_sa_clients {
            sa.mint(&caller, &100_000_000);
        }

        let mut user_balances = HashMap::new();
        for i in 0..4 {
            user_balances.insert(i, 100_000_000);
        }

        let swap_client = unsafe {
            std::mem::transmute::<MultiHopSwapClient<'_>, MultiHopSwapClient<'static>>(swap_client)
        };
        let pool_clients = unsafe {
            std::mem::transmute::<Vec<DiffMockPoolClient<'_>>, Vec<DiffMockPoolClient<'static>>>(pool_clients)
        };
        let token_clients = unsafe {
            std::mem::transmute::<Vec<token::Client<'_>>, Vec<token::Client<'static>>>(token_clients)
        };
        let token_sa_clients = unsafe {
            std::mem::transmute::<Vec<token::StellarAssetClient<'_>>, Vec<token::StellarAssetClient<'static>>>(token_sa_clients)
        };

        let model = MultiHopSwapReferenceModel {
            pool_rates: initial_rates,
            user_balances,
            last_output: None,
        };

        let harness = SwapContractHarness {
            env,
            swap_client,
            pool_clients,
            token_clients,
            token_sa_clients,
            pool_addrs,
            token_addrs,
            caller,
        };

        (model, harness)
    }

    fn generate_op(&self, prng: &mut DeterministicPrng, _model: &Self::Model) -> Self::Op {
        match prng.gen_range_u64(0, 3) {
            0 => {
                let pool_idx = prng.gen_range_usize(0, 2);
                let numer = prng.gen_range_i128(1, 4);
                let denom = prng.gen_range_i128(1, 3);
                SwapOp::SetPoolRate { pool_idx, numer, denom }
            }
            1 => {
                // 1-hop or 2-hop swap
                let hop_count = prng.gen_range_usize(1, 2);
                let mut hops = Vec::new();
                let amount_in = prng.gen_range_i128(100, 50_000);

                for h in 0..hop_count {
                    let pool_idx = h % 3;
                    let token_in_idx = h;
                    let token_out_idx = h + 1;
                    let min_out = if prng.gen_range_u64(0, 10) < 2 {
                        // Intentional slippage violation
                        amount_in * 10
                    } else {
                        // Achievable slippage
                        amount_in / 10
                    };
                    hops.push(HopParam {
                        pool_idx,
                        token_in_idx,
                        token_out_idx,
                        amount_in,
                        min_amount_out: min_out,
                    });
                }
                SwapOp::ExecuteSwap { hops }
            }
            2 => {
                let token_idx = prng.gen_range_usize(0, 3);
                let amount = prng.gen_range_i128(10_000, 100_000);
                SwapOp::FundUser { token_idx, amount }
            }
            _ => {
                let pool_idx = prng.gen_range_usize(0, 2);
                SwapOp::SetPoolRate { pool_idx, numer: 1, denom: 1 }
            }
        }
    }

    fn apply_model(&self, model: &mut Self::Model, op: &Self::Op) -> Result<String, String> {
        match op {
            SwapOp::SetPoolRate { pool_idx, numer, denom } => {
                model.pool_rates.insert(*pool_idx, (*numer, *denom));
                Ok(format!("rate_{}={}/{}", pool_idx, numer, denom))
            }
            SwapOp::FundUser { token_idx, amount } => {
                let bal = model.user_balances.entry(*token_idx).or_insert(0);
                *bal += *amount;
                Ok(format!("funded_{}={}", token_idx, bal))
            }
            SwapOp::ExecuteSwap { hops } => {
                if hops.is_empty() {
                    return Err("NoHops".to_string());
                }
                let first_hop = &hops[0];
                let user_bal = model.user_balances.get(&first_hop.token_in_idx).copied().unwrap_or(0);
                if user_bal < first_hop.amount_in {
                    return Err("InsufficientBalance".to_string());
                }

                let mut current_amount = 0i128;
                for (i, hop) in hops.iter().enumerate() {
                    let amount_in = if i == 0 { hop.amount_in } else { current_amount };
                    let (numer, denom) = model.pool_rates.get(&hop.pool_idx).copied().unwrap_or((1, 1));
                    let amount_out = amount_in * numer / denom;
                    if amount_out < hop.min_amount_out {
                        return Err("SlippageExceeded".to_string());
                    }
                    current_amount = amount_out;
                }

                // Apply balance changes
                let in_token = first_hop.token_in_idx;
                let out_token = hops.last().unwrap().token_out_idx;
                *model.user_balances.get_mut(&in_token).unwrap() -= first_hop.amount_in;
                *model.user_balances.entry(out_token).or_insert(0) += current_amount;
                model.last_output = Some(current_amount);

                Ok(format!("swap_out={}", current_amount))
            }
        }
    }

    fn apply_contract(&self, harness: &mut Self::ContractHarness, op: &Self::Op) -> Result<String, String> {
        match op {
            SwapOp::SetPoolRate { pool_idx, numer, denom } => {
                let pool_client = &harness.pool_clients[*pool_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    pool_client.set_rate(numer, denom);
                }));
                res.map(|_| format!("rate_{}={}/{}", pool_idx, numer, denom))
                    .map_err(|_| "ContractReverted".to_string())
            }
            SwapOp::FundUser { token_idx, amount } => {
                let sa = &harness.token_sa_clients[*token_idx];
                let caller = &harness.caller;
                let res = catch_unwind(AssertUnwindSafe(|| {
                    sa.mint(caller, amount);
                    harness.token_clients[*token_idx].balance(caller)
                }));
                res.map(|bal| format!("funded_{}={}", token_idx, bal))
                    .map_err(|_| "ContractReverted".to_string())
            }
            SwapOp::ExecuteSwap { hops } => {
                let mut soroban_hops = vec![&harness.env];
                for h in hops {
                    soroban_hops.push_back(Hop {
                        pool: harness.pool_addrs[h.pool_idx].clone(),
                        token_in: harness.token_addrs[h.token_in_idx].clone(),
                        token_out: harness.token_addrs[h.token_out_idx].clone(),
                        amount_in: h.amount_in,
                        min_amount_out: h.min_amount_out,
                    });
                }
                let caller = &harness.caller;
                let res = catch_unwind(AssertUnwindSafe(|| {
                    let results = harness.swap_client.swap(caller, &soroban_hops);
                    results.last().unwrap().amount_out
                }));
                res.map(|out| format!("swap_out={}", out))
                    .map_err(|_| "ContractReverted".to_string())
            }
        }
    }

    fn assert_invariants(&self, model: &Self::Model, harness: &Self::ContractHarness, _op: &Self::Op) -> Result<(), String> {
        // Invariant 1: Caller token balances match reference model exactly
        for (i, token_client) in harness.token_clients.iter().enumerate() {
            let c_bal = token_client.balance(&harness.caller);
            let m_bal = model.user_balances.get(&i).copied().unwrap_or(0);
            if c_bal != m_bal {
                return Err(format!("Caller balance mismatch for token {}: model={}, contract={}", i, m_bal, c_bal));
            }
        }

        // Invariant 2: No stranded tokens in the swap router contract
        let router_addr = &harness.swap_client.address;
        for (i, token_client) in harness.token_clients.iter().enumerate() {
            let r_bal = token_client.balance(router_addr);
            if r_bal != 0 {
                return Err(format!("Router token leak: contract holds {} of token {}", r_bal, i));
            }
        }

        // Invariant 3: Last output recorded in contract matches reference model
        if let Some(m_out) = model.last_output {
            let c_out = harness.swap_client.get_last_out().unwrap_or(0);
            if m_out != c_out {
                return Err(format!("Last output mismatch: model={}, contract={}", m_out, c_out));
            }
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
            "UserBalances: {:?}, PoolRates: {:?}, LastOut: {:?}",
            model.user_balances, model.pool_rates, model.last_output
        )
    }

    fn format_contract_state(&self, harness: &Self::ContractHarness) -> String {
        let mut b = Vec::new();
        for (i, tc) in harness.token_clients.iter().enumerate() {
            b.push(format!("T{}: {}", i, tc.balance(&harness.caller)));
        }
        format!("CallerBalances: [{}], LastOut: {:?}", b.join(", "), harness.swap_client.get_last_out())
    }
}

#[test]
fn test_swap_differential_fuzzing() {
    let config = FuzzConfig::default();
    run_fuzz_campaign(&SwapStateMachine, &config, 0x54A_9001);
}
