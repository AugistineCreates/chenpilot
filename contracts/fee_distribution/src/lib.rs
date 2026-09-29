#![no_std]
//! Fee distribution using cumulative per-share reward indices.
//!
//! Issue #674 replaces the iterative fee-distribution model with cumulative
//! per-share accounting. A naive scheme funds each participant by iterating,
//! so both the distribute work and the storage grow with participant count.
//! Here rewards accrue against a single global fixed-point index
//! (`reward_index`, "rewards per share" scaled by [`REWARD_PRECISION`]):
//!
//! * **Distribution is O(1).** `distribute` splits a fee into the treasury and
//!   AI-agent shares (transferred immediately) and folds the remaining LP
//!   residual into the reward pool by bumping the global index once. It never
//!   touches per-participant storage.
//! * **Claims are O(1) per participant.** A user's accrual since their last
//!   interaction is `shares * (current_index - recorded_index) / PRECISION`.
//! * **Late joins and partial exits are exact.** Any balance-changing
//!   interaction (`stake` / `unstake`) first settles accrued rewards against
//!   the *current* index and records that index on the user, so a participant
//!   can never claim rewards for shares they did not yet hold (late join) nor
//!   lose / double-claim rewards when exiting part of their position.
//! * **Rounding dust has a deterministic destination.** The index bump
//!   `lp_share * PRECISION / total_shares` truncates; the irreducible fraction
//!   `(lp_share * PRECISION) mod total_shares` and any per-claim truncation are
//!   retained in the contract's reward-pool balance. Dust is never minted or
//!   destroyed and never paid out twice — it deterministically stays in the
//!   pool as the protocol's defensive residual.
//!
//! Property tests in `test_property` compare every operation against a
//! high-precision rational reference model.
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, token, symbol_short,
};
use contract_failure::{fail, FailureReason};

/// Fixed-point precision for the cumulative reward index (Q12).
pub const REWARD_PRECISION: i128 = 1_000_000_000_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    DistributionNonce,
    LastDistribution,
    /// Global reward accumulator for a fee token.
    Rewards(Address),
    /// Per-user reward accumulator for a fee token.
    User(Address, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub treasury: Address,
    pub ai_agent_pool: Address,
    pub lp_pool: Address,
    pub treasury_bps: u32,
    pub ai_agent_bps: u32,
}

/// Global cumulative-reward accumulator for one fee token.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardsState {
    /// Total LP shares currently staked.
    pub total_shares: i128,
    /// Cumulative rewards accrued per share, scaled by [`REWARD_PRECISION`].
    pub reward_index: i128,
}

/// Per-participant reward accumulator for one fee token.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserRewards {
    /// Shares currently staked by this participant.
    pub shares: i128,
    /// Index recorded on the participant's last interaction.
    pub reward_index: i128,
    /// Accrued-but-unclaimed rewards (scaled by 1, i.e. actual token units).
    pub pending: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DistributionRecord {
    pub nonce: u32,
    pub token: Address,
    pub from: Address,
    pub amount: i128,
    pub treasury_share: i128,
    pub ai_agent_share: i128,
    pub lp_share: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub treasury: Address,
    pub ai_agent_pool: Address,
    pub lp_pool: Address,
    pub treasury_bps: u32,
    pub ai_agent_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtCfgUpd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub treasury: Address,
    pub ai_agent_pool: Address,
    pub lp_pool: Address,
    pub treasury_bps: u32,
    pub ai_agent_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSplit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub nonce: u32,
    pub token: Address,
    pub from: Address,
    pub amount: i128,
    pub treasury_share: i128,
    pub ai_agent_share: i128,
    pub lp_share: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtStake {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub token: Address,
    pub user: Address,
    pub amount: i128,
    pub total_shares: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtUnstake {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub token: Address,
    pub user: Address,
    pub amount: i128,
    pub total_shares: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtClaim {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub token: Address,
    pub user: Address,
    pub amount: i128,
}

#[contract]
pub struct FeeDistributionContract;

#[contractimpl]
impl FeeDistributionContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        treasury: Address,
        ai_agent_pool: Address,
        lp_pool: Address,
        treasury_bps: u32,
        ai_agent_bps: u32,
    ) {
        if env.storage().instance().has(&DataKey::Config) {
            fail(&env, FailureReason::AlreadyInitialized);
        }
        if treasury_bps + ai_agent_bps > 10_000 {
            fail(&env, FailureReason::InvalidBasisPoints);
        }
        env.storage().instance().set(&DataKey::Config, &Config { admin: admin.clone(), treasury: treasury.clone(), ai_agent_pool: ai_agent_pool.clone(), lp_pool: lp_pool.clone(), treasury_bps, ai_agent_bps });
        env.storage().instance().set(&DataKey::DistributionNonce, &0u32);

        env.events().publish(
            (symbol_short!("fees"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                admin,
                treasury,
                ai_agent_pool,
                lp_pool,
                treasury_bps,
                ai_agent_bps,
            },
        );
    }

    pub fn update_config(env: Env, config: Config) {
        let current_config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        current_config.admin.require_auth();
        if config.treasury_bps + config.ai_agent_bps > 10_000 {
            fail(&env, FailureReason::InvalidBasisPoints);
        }
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("fees"), symbol_short!("cfg_upd")),
            EvtCfgUpd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: current_config.admin.clone(),
                admin: config.admin.clone(),
                treasury: config.treasury.clone(),
                ai_agent_pool: config.ai_agent_pool.clone(),
                lp_pool: config.lp_pool.clone(),
                treasury_bps: config.treasury_bps,
                ai_agent_bps: config.ai_agent_bps,
            },
        );
    }

    // ── Cumulative reward indices ──────────────────────────────────────────

    fn rewards(env: &Env, token: &Address) -> RewardsState {
        env.storage()
            .instance()
            .get(&DataKey::Rewards(token.clone()))
            .unwrap_or(RewardsState { total_shares: 0, reward_index: 0 })
    }

    fn user_rewards(env: &Env, token: &Address, user: &Address) -> UserRewards {
        env.storage()
            .instance()
            .get(&DataKey::User(token.clone(), user.clone()))
            .unwrap_or(UserRewards { shares: 0, reward_index: 0, pending: 0 })
    }

    fn store_rewards(env: &Env, token: &Address, rs: &RewardsState) {
        env.storage().instance().set(&DataKey::Rewards(token.clone()), rs);
    }

    fn store_user(env: &Env, token: &Address, user: &Address, u: &UserRewards) {
        env.storage().instance().set(&DataKey::User(token.clone(), user.clone()), u);
    }

    /// Rewards accrued by `user` between their recorded index and the current
    /// global index. Integer truncation (dust) stays in the reward pool.
    fn accrued(rs: &RewardsState, u: &UserRewards) -> i128 {
        let delta = rs
            .reward_index
            .checked_sub(u.reward_index)
            .unwrap_or(0);
        u.shares
            .checked_mul(delta)
            .and_then(|n| n.checked_div(REWARD_PRECISION))
            .expect("reward accrual overflow")
    }

    /// Settle a user's accrued rewards, catching them up to the current index.
    /// Used before any balance-changing operation (stake / unstake / claim).
    fn settle(env: &Env, token: &Address, user: &Address) {
        let rs = Self::rewards(env, token);
        let mut u = Self::user_rewards(env, token, user);
        let pending = Self::accrued(&rs, &u);
        u.pending = u
            .pending
            .checked_add(pending)
            .expect("pending reward overflow");
        u.reward_index = rs.reward_index;
        Self::store_user(env, token, user, &u);
    }

    // ── Staking (participant shares) ─────────────────────────────────────────

    /// Deposit `amount` LP tokens and credit `amount` shares to `user`.
    ///
    /// Rewards are settled against the current index *before* shares increase,
    /// so a late joiner accrues nothing for shares they only now hold. O(1).
    pub fn stake(env: Env, token: Address, user: Address, amount: i128) -> i128 {
        Self::require_initialized(&env);
        if amount <= 0 {
            fail(&env, FailureReason::AmountNotPositive);
        }
        // Catch the user up to the current index before they gain more shares.
        Self::settle(&env, &token, &user);

        let mut rs = Self::rewards(&env, &token);
        let mut u = Self::user_rewards(&env, &token, &user);
        u.shares = u.shares.checked_add(amount).expect("share overflow");
        rs.total_shares = rs.total_shares.checked_add(amount).expect("share overflow");
        Self::store_user(&env, &token, &user, &u);
        Self::store_rewards(&env, &token, &rs);

        token::Client::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &user,
            &env.current_contract_address(),
            &amount,
        );

        env.events().publish(
            (symbol_short!("fees"), symbol_short!("stake")),
            EvtStake {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: user.clone(),
                token: token.clone(),
                user: user.clone(),
                amount,
                total_shares: rs.total_shares,
            },
        );
        u.shares
    }

    /// Withdraw `amount` LP tokens, settling accrued rewards first. O(1).
    pub fn unstake(env: Env, token: Address, user: Address, amount: i128) -> i128 {
        Self::require_initialized(&env);
        if amount <= 0 {
            fail(&env, FailureReason::AmountNotPositive);
        }
        Self::settle(&env, &token, &user);

        let mut rs = Self::rewards(&env, &token);
        let mut u = Self::user_rewards(&env, &token, &user);
        if amount > u.shares {
            fail(&env, FailureReason::InsufficientBalance);
        }
        u.shares = u.shares.checked_sub(amount).expect("share underflow");
        rs.total_shares = rs.total_shares.checked_sub(amount).expect("share underflow");
        Self::store_user(&env, &token, &user, &u);
        Self::store_rewards(&env, &token, &rs);

        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );

        env.events().publish(
            (symbol_short!("fees"), symbol_short!("unstake")),
            EvtUnstake {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: user.clone(),
                token: token.clone(),
                user: user.clone(),
                amount,
                total_shares: rs.total_shares,
            },
        );
        u.shares
    }

    /// Pay out a user's accrued rewards. O(1) per participant.
    pub fn claim(env: Env, token: Address, user: Address) -> i128 {
        Self::require_initialized(&env);
        Self::settle(&env, &token, &user);
        let mut u = Self::user_rewards(&env, &token, &user);
        let amount = u.pending;
        u.pending = 0;
        Self::store_user(&env, &token, &user, &u);

        if amount > 0 {
            token::Client::new(&env, &token).transfer(
                &env.current_contract_address(),
                &user,
                &amount,
            );
        }

        env.events().publish(
            (symbol_short!("fees"), symbol_short!("claim")),
            EvtClaim {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: user.clone(),
                token: token.clone(),
                user: user.clone(),
                amount,
            },
        );
        amount
    }

    /// Query a user's unclaimed accrued rewards, without settling or moving
    /// funds. Read-only.
    pub fn pending_rewards(env: Env, token: Address, user: Address) -> i128 {
        let rs = Self::rewards(&env, &token);
        let u = Self::user_rewards(&env, &token, &user);
        u.pending
            .checked_add(Self::accrued(&rs, &u))
            .expect("pending reward overflow")
    }

    pub fn get_user(env: Env, token: Address, user: Address) -> UserRewards {
        Self::user_rewards(&env, &token, &user)
    }

    pub fn get_rewards(env: Env, token: Address) -> RewardsState {
        Self::rewards(&env, &token)
    }

    // ── Distribution ──────────────────────────────────────────────────────────

    /// Split a fee and fold the LP residual into the cumulative reward pool.
    ///
    /// Treasury and AI-agent shares are transferred immediately (constant
    /// work). The LP residual is retained in the contract's reward pool and
    /// the global `reward_index` is bumped once — distribution is O(1).
    ///
    /// Rounding dust: the index bump `lp_share * PRECISION / total_shares`
    /// truncates; `(lp_share * PRECISION) mod total_shares` is kept in the pool
    /// (see module doc). If no shares are staked the LP residual is set aside
    /// in the pool and credited to no one (dormant dust, claimable by no
    /// participant until staking begins).
    pub fn distribute(env: Env, token_addr: Address, from: Address, amount: i128) -> DistributionRecord {
        Self::require_initialized(&env);
        if amount <= 0 {
            fail(&env, FailureReason::AmountNotPositive);
        }
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        let treasury_share = amount
            .checked_mul(config.treasury_bps as i128)
            .and_then(|n| n.checked_div(10_000))
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));
        let ai_agent_share = amount
            .checked_mul(config.ai_agent_bps as i128)
            .and_then(|n| n.checked_div(10_000))
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));
        let lp_share = amount
            .checked_sub(treasury_share)
            .and_then(|n| n.checked_sub(ai_agent_share))
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));

        // Pull the entire fee into this contract's reward pool, then pay the
        // treasury / AI-agent shares out of it. The LP residual stays in the
        // contract (the reward pool) and is paid to stakers via `claim`.
        let client = token::Client::new(&env, &token_addr);
        client.transfer_from(&env.current_contract_address(), &from, &env.current_contract_address(), &amount);

        if treasury_share > 0 {
            client.transfer(&env.current_contract_address(), &config.treasury, &treasury_share);
        }
        if ai_agent_share > 0 {
            client.transfer(&env.current_contract_address(), &config.ai_agent_pool, &ai_agent_share);
        }

        // Bump the cumulative reward index once. Dust from the truncation
        // remains in the reward pool.
        let mut rs = Self::rewards(&env, &token_addr);
        if rs.total_shares > 0 && lp_share > 0 {
            let increment = lp_share
                .checked_mul(REWARD_PRECISION)
                .and_then(|n| n.checked_div(rs.total_shares))
                .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));
            rs.reward_index = rs
                .reward_index
                .checked_add(increment)
                .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));
            Self::store_rewards(&env, &token_addr, &rs);
        } else if rs.total_shares > 0 {
            // lp_share could be 0 for tiny amounts; store latest state.
            Self::store_rewards(&env, &token_addr, &rs);
        }

        let nonce = env.storage().instance().get::<DataKey, u32>(&DataKey::DistributionNonce).unwrap_or(0);
        let record = DistributionRecord { nonce: nonce + 1, token: token_addr.clone(), from: from.clone(), amount, treasury_share, ai_agent_share, lp_share };
        env.storage().instance().set(&DataKey::DistributionNonce, &(nonce + 1));
        env.storage().instance().set(&DataKey::LastDistribution, &record);
        env.events().publish(
            (symbol_short!("fees"), symbol_short!("split")),
            EvtSplit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: from.clone(),
                nonce: record.nonce,
                token: token_addr.clone(),
                from: from.clone(),
                amount,
                treasury_share,
                ai_agent_share,
                lp_share,
            },
        );
        record
    }

    pub fn last_distribution(env: Env) -> Option<DistributionRecord> {
        env.storage().instance().get(&DataKey::LastDistribution)
    }

    pub fn get_config(env: Env) -> Config {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized))
    }

    fn require_initialized(env: &Env) {
        if !env.storage().instance().has(&DataKey::Config) {
            fail(env, FailureReason::NotInitialized);
        }
    }
}

mod test;
mod test_property;
#[cfg(test)]
mod test_diff_fuzz;
