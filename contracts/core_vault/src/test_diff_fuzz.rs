#![cfg(test)]

//! Differential state-machine fuzzer for Core Vault contract against an independent reference model.

use super::*;
use diff_fuzz_engine::{
    run_fuzz_campaign, DeterministicPrng, DifferentialStateMachine, FuzzConfig, LedgerSnapshot,
};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

const FORCE_EXIT_DELAY_SECONDS: u64 = 172_800; // 48 hours

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VaultOp {
    SetBackendOnline(bool),
    Pause,
    Unpause,
    Deposit { user_idx: usize, amount: i128 },
    Withdraw { user_idx: usize, amount: i128 },
    RequestForceExit { user_idx: usize },
    CompleteForceExit { user_idx: usize },
    AdvanceTime(u64),
}

#[derive(Clone, Debug)]
pub struct VaultReferenceModel {
    pub backend_online: bool,
    pub is_paused: bool,
    pub deposits: HashMap<usize, i128>,
    pub force_exits: HashMap<usize, (i128, u64)>, // user_idx -> (amount, eligible_at)
    pub current_time: u64,
    pub current_ledger: u32,
}

pub struct VaultContractHarness {
    pub env: Env,
    pub client: CoreVaultContractClient<'static>,
    pub token_client: token::Client<'static>,
    pub admin: Address,
    pub vault_token: Address,
    pub users: Vec<Address>,
}

pub struct VaultStateMachine;

impl DifferentialStateMachine for VaultStateMachine {
    type Op = VaultOp;
    type Model = VaultReferenceModel;
    type ContractHarness = VaultContractHarness;

    fn name(&self) -> &'static str {
        "CoreVault"
    }

    fn setup(&self, _prng: &mut DeterministicPrng) -> (Self::Model, Self::ContractHarness) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_700_000_000);
        env.ledger().set_sequence_number(100_000);

        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, CoreVaultContract);

        // Register test token and mint initial balances to test users
        let token_admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
        let token_sa = token::StellarAssetClient::new(&env, &token_addr);

        let mut users = Vec::new();
        for _ in 0..3 {
            let u = Address::generate(&env);
            token_sa.mint(&u, &10_000_000);
            users.push(u);
        }

        // We use unsafe lifetime extension for test client within the test harness
        let client = unsafe {
            std::mem::transmute::<CoreVaultContractClient<'_>, CoreVaultContractClient<'static>>(
                CoreVaultContractClient::new(&env, &contract_id),
            )
        };
        let token_client = unsafe {
            std::mem::transmute::<token::Client<'_>, token::Client<'static>>(
                token::Client::new(&env, &token_addr),
            )
        };

        client.init(&admin, &token_addr);
        client.set_backend_status(&true);

        let model = VaultReferenceModel {
            backend_online: true,
            is_paused: false,
            deposits: HashMap::new(),
            force_exits: HashMap::new(),
            current_time: 1_700_000_000,
            current_ledger: 100_000,
        };

        let harness = VaultContractHarness {
            env,
            client,
            token_client,
            admin,
            vault_token: token_addr,
            users,
        };

        (model, harness)
    }

    fn generate_op(&self, prng: &mut DeterministicPrng, _model: &Self::Model) -> Self::Op {
        match prng.gen_range_u64(0, 7) {
            0 => VaultOp::SetBackendOnline(prng.gen_bool()),
            1 => {
                if prng.gen_bool() {
                    VaultOp::Pause
                } else {
                    VaultOp::Unpause
                }
            }
            2 => VaultOp::Deposit {
                user_idx: prng.gen_range_usize(0, 2),
                amount: prng.gen_range_i128(10, 10_000),
            },
            3 => VaultOp::Withdraw {
                user_idx: prng.gen_range_usize(0, 2),
                amount: prng.gen_range_i128(10, 10_000),
            },
            4 => VaultOp::RequestForceExit {
                user_idx: prng.gen_range_usize(0, 2),
            },
            5 => VaultOp::CompleteForceExit {
                user_idx: prng.gen_range_usize(0, 2),
            },
            6 => VaultOp::AdvanceTime(prng.gen_range_u64(1, 200_000)),
            _ => VaultOp::Deposit {
                user_idx: prng.gen_range_usize(0, 2),
                amount: prng.gen_range_i128(100, 500),
            },
        }
    }

    fn apply_model(&self, model: &mut Self::Model, op: &Self::Op) -> Result<String, String> {
        match op {
            VaultOp::SetBackendOnline(online) => {
                model.backend_online = *online;
                Ok(format!("backend_online={}", online))
            }
            VaultOp::Pause => {
                model.is_paused = true;
                Ok("paused".to_string())
            }
            VaultOp::Unpause => {
                model.is_paused = false;
                Ok("unpaused".to_string())
            }
            VaultOp::Deposit { user_idx, amount } => {
                if model.is_paused {
                    return Err("VaultPaused".to_string());
                }
                if !model.backend_online {
                    return Err("BackendOffline".to_string());
                }
                if *amount <= 0 {
                    return Err("InvalidAmount".to_string());
                }
                let bal = model.deposits.entry(*user_idx).or_insert(0);
                *bal += *amount;
                Ok(format!("new_balance={}", *bal))
            }
            VaultOp::Withdraw { user_idx, amount } => {
                if !model.backend_online {
                    return Err("BackendOffline".to_string());
                }
                if *amount <= 0 {
                    return Err("InvalidAmount".to_string());
                }
                let bal = model.deposits.get_mut(user_idx).copied().unwrap_or(0);
                if bal < *amount {
                    return Err("InsufficientBalance".to_string());
                }
                let new_bal = bal - *amount;
                if new_bal == 0 {
                    model.deposits.remove(user_idx);
                } else {
                    model.deposits.insert(*user_idx, new_bal);
                }
                Ok(format!("new_balance={}", new_bal))
            }
            VaultOp::RequestForceExit { user_idx } => {
                if model.backend_online {
                    return Err("BackendOnline".to_string());
                }
                let bal = model.deposits.get(user_idx).copied().unwrap_or(0);
                if bal <= 0 {
                    return Err("InsufficientBalance".to_string());
                }
                if model.force_exits.contains_key(user_idx) {
                    return Err("ForceExitAlreadyPending".to_string());
                }
                let eligible_at = model.current_time + FORCE_EXIT_DELAY_SECONDS;
                model.force_exits.insert(*user_idx, (bal, eligible_at));
                Ok(format!("force_exit_requested={}", eligible_at))
            }
            VaultOp::CompleteForceExit { user_idx } => {
                let (amount, eligible_at) = match model.force_exits.get(user_idx) {
                    Some(&pair) => pair,
                    None => return Err("NoPendingForceExit".to_string()),
                };
                if model.current_time < eligible_at {
                    return Err("ChallengePeriodNotElapsed".to_string());
                }
                model.force_exits.remove(user_idx);
                model.deposits.remove(user_idx);
                Ok(format!("completed_amount={}", amount))
            }
            VaultOp::AdvanceTime(secs) => {
                model.current_time += *secs;
                model.current_ledger += (*secs / 5) as u32;
                Ok(format!("time_advanced_to={}", model.current_time))
            }
        }
    }

    fn apply_contract(&self, harness: &mut Self::ContractHarness, op: &Self::Op) -> Result<String, String> {
        let client = &harness.client;
        let users = &harness.users;

        match op {
            VaultOp::SetBackendOnline(online) => {
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.set_backend_status(online);
                }));
                res.map(|_| format!("backend_online={}", online))
                    .map_err(|_| "ContractReverted".to_string())
            }
            VaultOp::Pause => {
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.pause();
                }));
                res.map(|_| "paused".to_string())
                    .map_err(|_| "ContractReverted".to_string())
            }
            VaultOp::Unpause => {
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.unpause();
                }));
                res.map(|_| "unpaused".to_string())
                    .map_err(|_| "ContractReverted".to_string())
            }
            VaultOp::Deposit { user_idx, amount } => {
                let user = &users[*user_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.deposit(user, amount);
                    client.get_deposit(user).unwrap_or(0)
                }));
                res.map(|bal| format!("new_balance={}", bal))
                    .map_err(|_| "ContractReverted".to_string())
            }
            VaultOp::Withdraw { user_idx, amount } => {
                let user = &users[*user_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.withdrawal(user, amount);
                    client.get_deposit(user).unwrap_or(0)
                }));
                res.map(|bal| format!("new_balance={}", bal))
                    .map_err(|_| "ContractReverted".to_string())
            }
            VaultOp::RequestForceExit { user_idx } => {
                let user = &users[*user_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    client.force_exit_request(user);
                    client.get_force_exit(user).unwrap().eligible_at
                }));
                res.map(|el| format!("force_exit_requested={}", el))
                    .map_err(|_| "ContractReverted".to_string())
            }
            VaultOp::CompleteForceExit { user_idx } => {
                let user = &users[*user_idx];
                let res = catch_unwind(AssertUnwindSafe(|| {
                    let req = client.get_force_exit(user).unwrap();
                    client.force_exit_complete(user);
                    req.amount
                }));
                res.map(|amt| format!("completed_amount={}", amt))
                    .map_err(|_| "ContractReverted".to_string())
            }
            VaultOp::AdvanceTime(secs) => {
                let t = harness.env.ledger().timestamp() + *secs;
                let s = harness.env.ledger().sequence() + (*secs / 5) as u32;
                harness.env.ledger().set_timestamp(t);
                harness.env.ledger().set_sequence_number(s);
                Ok(format!("time_advanced_to={}", t))
            }
        }
    }

    fn assert_invariants(&self, model: &Self::Model, harness: &Self::ContractHarness, _op: &Self::Op) -> Result<(), String> {
        let client = &harness.client;

        // Invariant 1: Backend online parity
        let c_online = client.is_backend_online();
        if c_online != model.backend_online {
            return Err(format!("Backend online mismatch: model={}, contract={}", model.backend_online, c_online));
        }

        // Invariant 2: Pause state parity
        let c_paused = client.is_paused();
        if c_paused != model.is_paused {
            return Err(format!("Pause state mismatch: model={}, contract={}", model.is_paused, c_paused));
        }

        // Invariant 3: Per-user deposit balance matches reference model
        for (i, user) in harness.users.iter().enumerate() {
            let m_deposit = model.deposits.get(&i).copied();
            let c_deposit = client.get_deposit(user);
            if m_deposit != c_deposit {
                return Err(format!("Deposit balance mismatch for user {}: model={:?}, contract={:?}", i, m_deposit, c_deposit));
            }

            // Invariant 4: Force exit request matches reference model
            let m_fe = model.force_exits.get(&i);
            let c_fe = client.get_force_exit(user);
            match (m_fe, &c_fe) {
                (Some(&(m_amt, m_el)), Some(req)) => {
                    if req.amount != m_amt || req.eligible_at != m_el {
                        return Err(format!("Force exit mismatch for user {}: model=({}, {}), contract=({}, {})", i, m_amt, m_el, req.amount, req.eligible_at));
                    }
                }
                (None, None) => {}
                _ => return Err(format!("Force exit existence mismatch for user {}: model={:?}, contract={:?}", i, m_fe, c_fe.is_some())),
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
            "Backend: {}, Paused: {}, Time: {}, Deposits: {:?}, ForceExits: {:?}",
            model.backend_online, model.is_paused, model.current_time, model.deposits, model.force_exits
        )
    }

    fn format_contract_state(&self, harness: &Self::ContractHarness) -> String {
        format!(
            "Backend: {}, Paused: {}, ContractTokenBalance: {}",
            harness.client.is_backend_online(),
            harness.client.is_paused(),
            harness.token_client.balance(&harness.client.address)
        )
    }
}

#[test]
fn test_vault_differential_fuzzing() {
    let config = FuzzConfig::default();
    run_fuzz_campaign(&VaultStateMachine, &config, 0x5020_BA01);
}
