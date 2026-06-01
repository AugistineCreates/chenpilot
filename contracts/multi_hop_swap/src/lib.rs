#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contractclient, symbol_short, vec, Env, Address, Vec, token};

/// One leg of a swap route.
#[contracttype]
#[derive(Clone)]
pub struct Hop {
    pub pool: Address,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub min_amount_out: i128,
}

/// Result of a single hop execution.
#[contracttype]
#[derive(Clone)]
pub struct HopResult {
    pub pool: Address,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub amount_out: i128,
}

/// Pool interface trait — downstream pools must implement this.
#[contractclient(name = "PoolClient")]
pub trait PoolTrait {
    /// Execute a swap on this pool.
    /// Returns the actual amount out.
    fn swap(env: Env, to: Address, token_in: Address, token_out: Address, amount_in: i128, min_amount_out: i128) -> i128;
}

#[contract]
pub struct MultiHopSwap;

#[contractimpl]
impl MultiHopSwap {
    /// Execute a multi-hop swap across `hops` pools.
    /// Each hop: transfers tokens to pool, calls pool's swap, transfers output to next hop (or caller at end).
    /// Returns results for each hop.
    pub fn swap(env: Env, caller: Address, hops: Vec<Hop>) -> Vec<HopResult> {
        caller.require_auth();

        if hops.is_empty() {
            panic!("no hops provided");
        }

        let mut results = vec![&env];
        let mut current_amount = 0_i128;
        let contract_address = env.current_contract_address();

        // Process each hop
        for (i, hop) in hops.iter().enumerate() {
            let amount_in = if i == 0 {
                // First hop: pull tokens from caller
                let token_in_client = token::Client::new(&env, &hop.token_in);
                token_in_client.transfer(&caller, &contract_address, &hop.amount_in);
                hop.amount_in
            } else {
                // Subsequent hops: use output from previous hop
                current_amount
            };

            // Transfer tokens to pool
            let token_in_client = token::Client::new(&env, &hop.token_in);
            token_in_client.transfer(&contract_address, &hop.pool, &amount_in);

            // Call pool to perform swap
            let pool_client = PoolClient::new(&env, &hop.pool);
            let amount_out = pool_client.swap(
                &contract_address,
                &hop.token_in,
                &hop.token_out,
                &amount_in,
                &hop.min_amount_out,
            );

            // Validate slippage
            if amount_out < hop.min_amount_out {
                panic!("slippage exceeded");
            }

            // Record result
            results.push_back(HopResult {
                pool: hop.pool.clone(),
                token_in: hop.token_in.clone(),
                token_out: hop.token_out.clone(),
                amount_in,
                amount_out,
            });

            // Update current amount for next hop
            current_amount = amount_out;

            // Emit event
            env.events().publish(
                (symbol_short!("hop"), hop.pool.clone()),
                (hop.token_in.clone(), hop.token_out.clone(), amount_in, amount_out),
            );
        }

        // Transfer final output to caller
        let last_hop = hops.last().unwrap();
        let token_out_client = token::Client::new(&env, &last_hop.token_out);
        token_out_client.transfer(&contract_address, &caller, &current_amount);

        // Record last output amount in instance storage for convenience
        env.storage()
            .instance()
            .set(&symbol_short!("last_out"), &current_amount);

        results
    }

    /// Returns the last output amount recorded.
    pub fn get_last_out(env: Env) -> Option<i128> {
        env.storage().instance().get(&symbol_short!("last_out"))
    }
}

mod test;
