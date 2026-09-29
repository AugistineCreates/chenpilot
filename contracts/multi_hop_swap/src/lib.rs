#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contractclient, symbol_short, vec, Env, Address, Vec, token, Bytes, BytesN};

// TTL for swap state: ~30 days (6_048_000 ledgers at 5s/ledger)
const SWAP_STATE_TTL_LEDGERS: u32 = 6_048_000;

/// Swap status enum
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SwapStatus {
    Completed,
}

#[contracttype]
#[derive(Clone)]
pub struct Hop {
    pub pool: Address,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub min_amount_out: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct HopResult {
    pub pool: Address,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub amount_out: i128,
}

/// Full swap state stored on chain
#[contracttype]
#[derive(Clone)]
pub struct Swap {
    pub caller: Address,
    pub hops: Vec<Hop>,
    pub results: Vec<HopResult>,
    pub status: SwapStatus,
    pub created_ledger: u32,
}

/// Storage key enum
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Swap(BytesN<32>),
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
    /// Returns swap_id and results for each hop.
    pub fn swap(env: Env, caller: Address, hops: Vec<Hop>) -> (BytesN<32>, Vec<HopResult>) {
        caller.require_auth();

        if hops.is_empty() {
            panic!("no hops provided");
        }

        let swap_id = Self::derive_swap_id(&env, &caller, &hops, env.ledger().sequence());

        if env.storage().persistent().has(&DataKey::Swap(swap_id.clone())) {
            panic!("swap already executed (replay attempt)");
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

            // Emit per-hop event
            env.events().publish(
                (symbol_short!("swap"), symbol_short!("hop")),
                EvtHop {
                    version: 1,
                    ledger: env.ledger().sequence(),
                    actor: caller.clone(),
                    pool: hop.pool.clone(),
                    token_in: hop.token_in.clone(),
                    token_out: hop.token_out.clone(),
                    amount_in,
                    amount_out,
                },
            );

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

            // Emit event with swap ID
            env.events().publish(
                (symbol_short!("hop"), swap_id.clone(), hop.pool.clone()),
                (hop.token_in.clone(), hop.token_out.clone(), amount_in, amount_out),
            );
        }

        // Transfer final output to caller
        let last_hop = hops.last().unwrap();
        let token_out_client = token::Client::new(&env, &last_hop.token_out);
        token_out_client.transfer(&contract_address, &caller, &current_amount);

        env.events().publish(
            (symbol_short!("swap"), symbol_short!("done")),
            EvtSwapDone {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: caller,
                total_amount_in: hops.get(0).map(|h| h.amount_in).unwrap_or(0),
                total_amount_out: current_amount,
            },
        );

        // Record last output amount in instance storage for convenience
        env.storage()
            .instance()
            .set(&symbol_short!("last_out"), &current_amount);

        // Store swap state
        let swap = Swap {
            caller: caller.clone(),
            hops: hops.clone(),
            results: results.clone(),
            status: SwapStatus::Completed,
            created_ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set_with_ttl(&DataKey::Swap(swap_id.clone()), &swap, SWAP_STATE_TTL_LEDGERS);

        // Emit swap completion event with swap ID
        env.events().publish(
            (symbol_short!("SwapCompleted"),),
            (swap_id.clone(), caller.clone(), current_amount),
        );

        (swap_id, results)
    }

    /// Returns the last output amount recorded.
    pub fn get_last_out(env: Env) -> Option<i128> {
        env.storage().instance().get(&symbol_short!("last_out"))
    }

    /// Returns swap details for given swap_id
    pub fn get_swap(env: Env, swap_id: BytesN<32>) -> Option<Swap> {
        env.storage().persistent().get(&DataKey::Swap(swap_id))
    }

    // Internal: derive unique swap ID
    fn derive_swap_id(env: &Env, caller: &Address, hops: &Vec<Hop>, created_ledger: u32) -> BytesN<32> {
        let mut data = Bytes::new(env);
        // Add caller address
        data.extend_from_slice(&caller.to_array());
        // Add created ledger as LE bytes
        data.push_back((created_ledger & 0xff) as u8);
        data.push_back(((created_ledger >> 8) & 0xff) as u8);
        data.push_back(((created_ledger >> 16) & 0xff) as u8);
        data.push_back(((created_ledger >> 24) & 0xff) as u8);
        // Add number of hops
        data.push_back(hops.len() as u8);
        // Add each hop's details
        for hop in hops.iter() {
            data.extend_from_slice(&hop.pool.to_array());
            data.extend_from_slice(&hop.token_in.to_array());
            data.extend_from_slice(&hop.token_out.to_array());
            // Add amount_in as LE bytes (16 bytes for i128)
            let amount_bytes = hop.amount_in.to_le_bytes();
            for b in amount_bytes {
                data.push_back(b);
            }
        }
        env.crypto().sha256(&data).into()
    }
}

mod test;
#[cfg(test)]
mod test_diff_fuzz;
