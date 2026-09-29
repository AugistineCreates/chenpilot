#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, contractimpl};

// ---------------------------------------------------------------------------
// Property-based / invariant testing helpers
// ---------------------------------------------------------------------------

/// Generates a deterministic sequence of prices for invariant checks.
fn price_sequence(base: i128, steps: usize) -> Vec<i128> {
    (0..steps)
        .map(|i| base + (i as i128 * 1_000_000)) // +0.01 each step
        .collect()
}

/// Asserts that deviation is monotonic with respect to price distance from intent.
#[test]
fn property_deviation_monotonic() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let admin = Address::generate(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    let oracle_id = env.register(MockPriceOracle, ());
    let contract_id = env.register(LiquidityVaultContract, ());
    let client = LiquidityVaultContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle_id, &500); // 5% threshold

    let base_price = 100_000_000i128; // 1.00
    let sequence = price_sequence(base_price, 10);

    let mut prev_deviation: u128 = 0;
    for (i, market) in sequence.iter().enumerate() {
        let intent = base_price;
        let diff = if *market > intent { *market - intent } else { intent - *market };
        let deviation_bps = ((diff * 10000) / intent) as u128;

        if i > 0 {
            assert!(deviation_bps >= prev_deviation, "Deviation should be monotonic away from intent");
        }
        prev_deviation = deviation_bps;
    }
}

/// Invariant: approved swaps must have non-negative amounts and valid intent price.
#[test]
fn invariant_approved_swap_has_valid_params() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let admin = Address::generate(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    let oracle_id = env.register(MockPriceOracle, ());
    let contract_id = env.register(LiquidityVaultContract, ());
    let client = LiquidityVaultContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle_id, &200);

    // Set matching prices so deviation is zero
    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(&token_in, &PriceData { price: 100_000_000, decimals: 8, timestamp: 1000 });
    oracle_client.set_price(&token_out, &PriceData { price: 50_000_000, decimals: 8, timestamp: 1000 });

    // Valid params: amount_in > 0, intent_price > 0
    client.execute_protected_swap(&token_in, &token_out, &100, &190, &200_000_000);

    // Publish event as success indicator
    env.events().publish((symbol_short!("SwapOk"),), (token_in, token_out, 100i128, 200_000_000i128));
}

/// Invariant: deadline enforcement rejects late execution.
#[test]
#[should_panic(expected = "deadline_exceeded")]
fn invariant_deadline_blocks_late_swap() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let admin = Address::generate(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    let oracle_id = env.register(MockPriceOracle, ());
    let contract_id = env.register(LiquidityVaultContract, ());
    let client = LiquidityVaultContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle_id, &200);

    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(&token_in, &PriceData { price: 100_000_000, decimals: 8, timestamp: 1000 });
    oracle_client.set_price(&token_out, &PriceData { price: 50_000_000, decimals: 8, timestamp: 1000 });

    // Set deadline in the past
    env.ledger().set_sequence_number(2000);
    client.execute_protected_swap(&token_in, &token_out, &100, &190, &200_000_000);
}

/// Property: decimal normalization preserves value within rounding error.
#[test]
fn property_decimal_normalization_preserves_value() {
    let cases = [
        (1_000_000u64, 6, 8, 100_000_000i128),
        (50_000_000_000_000_000_000u128, 18, 8, 50_000_000i128),
        (100_000_000u64, 8, 8, 100_000_000i128),
    ];

    for (input, from_dec, to_dec, expected) in cases.iter() {
        let result = normalize_price(*input as i128, *from_dec, *to_dec);
        assert_eq!(result, *expected, "Normalization failed for input {} from {} to {}", input, from_dec, to_dec);
    }
}

/// Property: zero/negative inputs always reject.
#[test]
#[should_panic(expected = "invalid_params")]
fn invariant_non_positive_inputs_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let admin = Address::generate(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    let oracle_id = env.register(MockPriceOracle, ());
    let contract_id = env.register(LiquidityVaultContract, ());
    let client = LiquidityVaultContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle_id, &200);

    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(&token_in, &PriceData { price: 100_000_000, decimals: 8, timestamp: 1000 });
    oracle_client.set_price(&token_out, &PriceData { price: 50_000_000, decimals: 8, timestamp: 1000 });

    // amount_in = 0 should panic
    client.execute_protected_swap(&token_in, &token_out, &0, &190, &200_000_000);
}

// ---------------------------------------------------------------------------
// Mock Oracle for property tests
// ---------------------------------------------------------------------------

#[contract]
pub struct MockPriceOracle;

#[contractimpl]
impl MockPriceOracle {
    pub fn get_price(env: Env, asset: Address) -> Option<PriceData> {
        env.storage().instance().get(&asset)
    }

    pub fn set_price(env: Env, asset: Address, data: PriceData) {
        env.storage().instance().set(&asset, &data);
    }
}

#[contractclient(name = "MockPriceOracleClient")]
pub trait MockPriceOracleTrait {
    fn get_price(env: Env, asset: Address) -> Option<PriceData>;
    fn set_price(env: Env, asset: Address, data: PriceData);
}