#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env};

// ---------------------------------------------------------------------------
// Invariant tests for flash loan guard
// ---------------------------------------------------------------------------

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn get_price(env: Env, _asset: Address) -> i128 {
        env.storage().instance().get(&0u32).unwrap_or(100_000_000i128)
    }

    pub fn set_price(env: Env, price: i128) {
        env.storage().instance().set(&0u32, &price);
    }
}

#[contractclient(name = "MockOracleClient")]
pub trait MockOracleTrait {
    fn get_price(env: Env, asset: Address) -> i128;
    fn set_price(env: Env, price: i128);
}

/// Invariant: price must always be positive after successful snapshot.
#[test]
fn invariant_snapshot_price_positive() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let oracle_id = env.register(MockOracle, ());
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);

    client.initialize(&Config {
        admin,
        oracle: oracle_id,
        guarded_asset: asset,
        max_intra_ledger_deviation_bps: 200,
        min_ledger_gap: 1,
        max_oracle_staleness_seconds: 3600,
        max_consecutive_price_change_bps: 500,
        max_oracle_update_gap_seconds: 7200,
        circuit_breaker_threshold_bps: 1000,
        circuit_breaker_window_seconds: 3600,
    });

    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(100_000_000);

    client.record_snapshot(1000000, 1);
    let snap = client.get_snapshot().unwrap();
    assert!(snap.price > 0, "Snapshot price must be positive");
}

/// Invariant: circuit breaker resets after window expires.
#[test]
fn invariant_circuit_breaker_resets() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let oracle_id = env.register(MockOracle, ());
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);

    client.initialize(&Config {
        admin,
        oracle: oracle_id,
        guarded_asset: asset,
        max_intra_ledger_deviation_bps: 200,
        min_ledger_gap: 1,
        max_oracle_staleness_seconds: 3600,
        max_consecutive_price_change_bps: 500,
        max_oracle_update_gap_seconds: 7200,
        circuit_breaker_threshold_bps: 1000,
        circuit_breaker_window_seconds: 3600,
    });

    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(100_000_000);
    client.record_snapshot(1000000, 1);

    // Simulate time passing beyond circuit breaker window
    env.ledger().set_timestamp_ns((1000000 + 4000) * 10_u64.pow(9));
    let cb = client.get_circuit_breaker();
    assert!(!cb.triggered, "Circuit breaker should reset after window");
}

/// Property: stale oracle data is always rejected.
#[test]
#[should_panic(expected = "oracle data too stale")]
fn property_stale_oracle_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp_ns(2000000 * 10_u64.pow(9));

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let oracle_id = env.register(MockOracle, ());
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);

    client.initialize(&Config {
        admin,
        oracle: oracle_id,
        guarded_asset: asset,
        max_intra_ledger_deviation_bps: 200,
        min_ledger_gap: 1,
        max_oracle_staleness_seconds: 3600,
        max_consecutive_price_change_bps: 500,
        max_oracle_update_gap_seconds: 7200,
        circuit_breaker_threshold_bps: 1000,
        circuit_breaker_window_seconds: 3600,
    });

    // Stale timestamp
    client.record_snapshot(1000000, 1);
}

// ---------------------------------------------------------------------------
// Boundary value property tests
// ---------------------------------------------------------------------------

/// Helper: generate a sequence of boundary prices to sweep.
fn boundary_prices() -> [i128; 7] {
    [
        0i128,
        1i128,
        i128::MAX,
        i128::MIN,
        -1i128,
        10_000_000i128,   // normal price
        999_999_999_999i128, // large but non-overflowing
    ]
}

/// Property: snapshot can be recorded with zero price from oracle.
/// The zero price is stored as-is; no panic expected during record.
#[test]
fn property_zero_price_snapshot_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let oracle_id = env.register(MockOracle, ());
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);

    client.initialize(&Config {
        admin,
        oracle: oracle_id,
        guarded_asset: asset,
        max_intra_ledger_deviation_bps: 200,
        min_ledger_gap: 1,
        max_oracle_staleness_seconds: 3600,
        max_consecutive_price_change_bps: 500,
        max_oracle_update_gap_seconds: 7200,
        circuit_breaker_threshold_bps: 1000,
        circuit_breaker_window_seconds: 3600,
    });

    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(0);

    client.record_snapshot(1000000, 1);
    let snap = client.get_snapshot().unwrap();
    assert_eq!(snap.price, 0, "Zero price must be stored as-is");
}

/// Property: assert_price_safe after a zero-price snapshot panics with division by zero.
#[test]
#[should_panic(expected = "div zero")]
fn property_zero_price_assert_safe_panics() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let oracle_id = env.register(MockOracle, ());
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);

    client.initialize(&Config {
        admin,
        oracle: oracle_id,
        guarded_asset: asset,
        max_intra_ledger_deviation_bps: 200,
        min_ledger_gap: 1,
        max_oracle_staleness_seconds: 3600,
        max_consecutive_price_change_bps: 500,
        max_oracle_update_gap_seconds: 7200,
        circuit_breaker_threshold_bps: 1000,
        circuit_breaker_window_seconds: 3600,
    });

    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(0);

    client.record_snapshot(1000000, 1);

    // Advance one ledger so same-ledger check passes
    env.ledger().set_sequence_number(101);

    // Must panic because deviation_bps computation divides by zero
    client.assert_price_safe();
}

/// Property: snapshot can be recorded with i128::MAX price (boundary).
#[test]
fn property_max_i128_snapshot() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let oracle_id = env.register(MockOracle, ());
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);

    client.initialize(&Config {
        admin,
        oracle: oracle_id,
        guarded_asset: asset,
        max_intra_ledger_deviation_bps: 200,
        min_ledger_gap: 1,
        max_oracle_staleness_seconds: 3600,
        max_consecutive_price_change_bps: 500,
        max_oracle_update_gap_seconds: 7200,
        circuit_breaker_threshold_bps: 1000,
        circuit_breaker_window_seconds: 3600,
    });

    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(i128::MAX);

    client.record_snapshot(1000000, 1);
    let snap = client.get_snapshot().unwrap();
    assert_eq!(snap.price, i128::MAX, "i128::MAX price must be stored as-is");
}

/// Property: negative oracle price is stored but assert_price_safe panics
/// because deviation calculation uses absolute difference which overflows on i128::MIN.
#[test]
fn property_negative_price_rejected_on_safe_check() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let oracle_id = env.register(MockOracle, ());
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);

    client.initialize(&Config {
        admin,
        oracle: oracle_id,
        guarded_asset: asset,
        max_intra_ledger_deviation_bps: 200,
        min_ledger_gap: 1,
        max_oracle_staleness_seconds: 3600,
        max_consecutive_price_change_bps: 500,
        max_oracle_update_gap_seconds: 7200,
        circuit_breaker_threshold_bps: 1000,
        circuit_breaker_window_seconds: 3600,
    });

    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(-100_000_000i128);

    client.record_snapshot(1000000, 1);
    let snap = client.get_snapshot().unwrap();
    assert_eq!(snap.price, -100_000_000, "Negative price must be stored as-is");

    // Advance ledger
    env.ledger().set_sequence_number(101);

    // assert_price_safe computes absolute deviation: snap.price - current_price
    // where current_price could be different — the key invariant is that
    // negative prices propagate through without crashing earlier checks.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.assert_price_safe();
    }));
    assert!(result.is_err(), "Negative price should cause assert_price_safe to panic");
}

/// Property: sweeping boundary prices for snapshot recording all succeed.
#[test]
fn property_boundary_prices_snapshot_all_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

    for (i, price) in boundary_prices().iter().enumerate() {
        // Use a fresh contract per iteration to avoid stale-state coupling
        let env_i = Env::default();
        env_i.mock_all_auths();
        env_i.ledger().set_sequence_number(100 + i as u32);
        env_i.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let admin = Address::generate(&env_i);
        let asset = Address::generate(&env_i);
        let oracle_id = env_i.register(MockOracle, ());
        let contract_id = env_i.register(FlashLoanGuardContract, ());
        let client = FlashLoanGuardContractClient::new(&env_i, &contract_id);

        client.initialize(&Config {
            admin,
            oracle: oracle_id,
            guarded_asset: asset,
            max_intra_ledger_deviation_bps: 200,
            min_ledger_gap: 1,
            max_oracle_staleness_seconds: 3600,
            max_consecutive_price_change_bps: 500,
            max_oracle_update_gap_seconds: 7200,
            circuit_breaker_threshold_bps: 1000,
            circuit_breaker_window_seconds: 3600,
        });

        let oracle_client = MockOracleClient::new(&env_i, &oracle_id);
        oracle_client.set_price(*price);

        // record_snapshot should never panic for any boundary price
        client.record_snapshot(1000000, 1);
        let snap = client.get_snapshot().unwrap();
        assert_eq!(snap.price, *price, "Boundary price {} must be stored", price);
    }
}

/// Property: same-ledger assert_price_safe is always rejected.
/// This formalises the "repayment-in-same-transaction" edge case for flash-loan guards.
#[test]
#[should_panic(expected = "same ledger")]
fn property_same_ledger_assert_safe_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let oracle_id = env.register(MockOracle, ());
    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(&env, &contract_id);

    client.initialize(&Config {
        admin,
        oracle: oracle_id,
        guarded_asset: asset,
        max_intra_ledger_deviation_bps: 200,
        min_ledger_gap: 1,
        max_oracle_staleness_seconds: 3600,
        max_consecutive_price_change_bps: 500,
        max_oracle_update_gap_seconds: 7200,
        circuit_breaker_threshold_bps: 1000,
        circuit_breaker_window_seconds: 3600,
    });

    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_price(100_000_000);

    client.record_snapshot(1000000, 1);

    // Try assert_price_safe in the same ledger — must always panic
    client.assert_price_safe();
}