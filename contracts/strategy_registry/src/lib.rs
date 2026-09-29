#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Env, Address, BytesN, Vec};

// TTL for vote data: ~7 days (1_209_600 ledgers at 5s/ledger)
// Votes decay over time to encourage fresh strategy voting and prevent stale governance
const VOTE_TTL_LEDGERS: u32 = 1_209_600;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    AiAgent(Address),
    VerifiedPool(BytesN<32>),
    PoolMeta(BytesN<32>),
    CurrentStrategy,
    Votes(BytesN<32>),
    VotedPools,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtAgentSet {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub ai_agent: Address,
    pub authorized: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtPoolAdd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub pool_id: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtPoolRm {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub pool_id: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtVote {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub ai_agent: Address,
    pub pool_id: BytesN<32>,
    pub verified_ledger: u32,
    pub total_votes: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct PoolInfo {
    pub added_ledger: u32,
}

#[contract]
pub struct StrategyRegistryContract;

#[contractimpl]
impl StrategyRegistryContract {
    /// Initialize the contract with an admin
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);

        env.events().publish(
            (symbol_short!("strat"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                admin,
            },
        );
    }

    /// Set an AI agent's authorization status (Admin only)
    pub fn set_ai_agent(env: Env, ai_agent: Address, authorized: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        // Trust assumption: This privileged call must come directly from the admin.
        // Soroban's require_auth binds to this contract, function, and args, but does not
        // restrict the immediate caller. Requiring the caller to be the admin prevents
        // confused-deputy attacks via malicious intermediary contracts.
        if env.caller() != admin {
            panic!("caller is not admin");
        }
        env.storage().instance().set(&DataKey::AiAgent(ai_agent.clone()), &authorized);

        env.events().publish(
            (symbol_short!("strat"), symbol_short!("agent_set")),
            EvtAgentSet {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                ai_agent,
                authorized,
            },
        );
    }

    /// Add a verified pool (Admin only)
    pub fn add_verified_pool(env: Env, pool_id: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        // Trust assumption: This privileged call must come directly from the admin.
        // Prevents confused-deputy attacks via nested invocations.
        if env.caller() != admin {
            panic!("caller is not admin");
        }
        env.storage().instance().set(&DataKey::VerifiedPool(pool_id.clone()), &true);
        env.storage().instance().set(&DataKey::PoolMeta(pool_id.clone()), &PoolInfo { added_ledger: env.ledger().sequence() });

        env.events().publish(
            (symbol_short!("strat"), symbol_short!("pool_add")),
            EvtPoolAdd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                pool_id,
            },
        );
    }

    /// Remove a verified pool (Admin only)
    pub fn remove_verified_pool(env: Env, pool_id: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        // Trust assumption: This privileged call must come directly from the admin.
        // Prevents confused-deputy attacks via nested invocations.
        if env.caller() != admin {
            panic!("caller is not admin");
        }
        env.storage().instance().remove(&DataKey::VerifiedPool(pool_id.clone()));
        env.storage().instance().remove(&DataKey::PoolMeta(pool_id.clone()));

        env.events().publish(
            (symbol_short!("strat"), symbol_short!("pool_rm")),
            EvtPoolRm {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                pool_id,
            },
        );
    }

    /// Check if a pool is verified
    pub fn is_pool_verified(env: Env, pool_id: BytesN<32>) -> bool {
        env.storage().instance().get(&DataKey::VerifiedPool(pool_id)).unwrap_or(false)
    }

    /// Resolve a verified pool to its metadata. Panics if not verified.
    pub fn resolve_pool(env: Env, pool_id: BytesN<32>) -> PoolInfo {
        let verified: bool = env.storage().instance().get(&DataKey::VerifiedPool(pool_id.clone())).unwrap_or(false);
        if !verified {
            panic!("Pool is not verified");
        }
        env.storage().instance().get(&DataKey::PoolMeta(pool_id)).unwrap()
    }

    /// Vote for a strategy (AI agent only, must be verified pool)
    pub fn vote_strategy(env: Env, ai_agent: Address, pool_id: BytesN<32>) {
        ai_agent.require_auth();
        // Trust assumption: This privileged call must come directly from the AI agent.
        // Prevents an intermediary contract from reusing the AI agent's authorization tree.
        if env.caller() != ai_agent {
            panic!("caller is not AI agent");
        }

        // Check if the AI agent is authorized
        let is_authorized: bool = env.storage().instance().get(&DataKey::AiAgent(ai_agent.clone())).unwrap_or(false);
        if !is_authorized {
            panic!("AI agent not authorized");
        }

        // Check if the pool is verified and resolve provenance
        let pool_info = Self::resolve_pool(env.clone(), pool_id.clone());

        // Cast vote with TTL to decay old votes naturally
        let mut votes: u32 = env.storage().instance().get(&DataKey::Votes(pool_id.clone())).unwrap_or(0);
        votes += 1;
        env.storage().instance().set_with_ttl(&DataKey::Votes(pool_id.clone()), &votes, VOTE_TTL_LEDGERS);

        // Keep track of voted pools to determine the winner
        let mut voted_pools: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::VotedPools).unwrap_or(Vec::new(&env));
        if !voted_pools.contains(&pool_id) {
            voted_pools.push_back(pool_id.clone());
            env.storage().instance().set(&DataKey::VotedPools, &voted_pools);
        }

        // Update current strategy based on votes
        let mut max_votes = 0;
        let mut best_pool = pool_id.clone();
        
        for pool in voted_pools.iter() {
            let p_votes: u32 = env.storage().instance().get(&DataKey::Votes(pool.clone())).unwrap_or(0);
            if p_votes > max_votes {
                max_votes = p_votes;
                best_pool = pool;
            }
        }
        
        env.storage().instance().set(&DataKey::CurrentStrategy, &best_pool);

        env.events().publish(
            (symbol_short!("strat"), symbol_short!("vote")),
            EvtVote {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: ai_agent.clone(),
                ai_agent,
                pool_id,
                verified_ledger: pool_info.added_ledger,
                total_votes: votes,
            },
        );
    }

    /// Get the current chosen strategy
    pub fn get_current_strategy(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::CurrentStrategy)
    }
}

mod test;
#[cfg(test)]
mod test_diff_fuzz;
