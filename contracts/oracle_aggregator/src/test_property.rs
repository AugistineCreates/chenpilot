#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    Address, Env,
};

#[contract]
pub struct PropMockSource;

#[contractimpl]
impl PropMockSource {
    pub fn get_price(env: Env) -> SourceReading {
        env.storage()
            .instance()
            .get(&0u32)
            .unwrap_or(SourceReading { price: 100_000_000, decimals: 8, timestamp: 0 })
    }

    pub fn set_price(env: Env, price: i128, decimals: u32, timestamp: u64) {
        env.storage()
            .instance()
            .set(&0u32, &SourceReading { price, decimals, timestamp });
    }
}

fn config_with(admin: &Address, min_sources: u32, min_weight_bps: u32, max_staleness: u64, max_deviation_bps: i128) -> AggregateConfig {
    AggregateConfig {
        admin: admin.clone(),
        min_quorum_sources: min_sources,
        min_quorum_weight_bps: min_weight_bps,
        max_staleness_seconds: max_staleness,
        max_deviation_bps,
        output_decimals: 8,
    }
}

fn make_source(env: &Env, client: &OracleAggregatorContractClient, weight_bps: u32, price: i128, timestamp: u64) -> Address {
    let id = env.register(PropMockSource, ());
    let source_client = PropMockSourceClient::new(env, &id);
    source_client.set_price(&price, &8u32, &timestamp);
    client.add_source(&id, &weight_bps, &8u32);
    id
}

// ---------------------------------------------------------------------------
// Property: minority Byzantine sources cannot move the aggregate price
// beyond the deviation band, and are counted as rejected — for a sweep of
// how far off the malicious price is.
// ---------------------------------------------------------------------------

#[test]
fn property_median_robust_to_minority_byzantine_sources() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);

    // 5 honest sources agreeing at $1.00, quorum requires 4/5 sources and
    // 80% weight so at most one Byzantine source (weight 2_000 of 10_000)
    // can be tolerated per call.
    let admin = Address::generate(&env);
    let contract_id = env.register(OracleAggregatorContract, ());
    let client = OracleAggregatorContractClient::new(&env, &contract_id);
    client.initialize(&config_with(&admin, 4, 8_000, 300, 500)); // 5% band

    for _ in 0..4 {
        make_source(&env, &client, 2_000, 100_000_000, 10_000);
    }

    // Sweep how wildly the single Byzantine source lies, from just outside
    // the band up to a large multiple of the honest price.
    for malicious_price in [110_000_000i128, 150_000_000, 500_000_000, 1_000_000_000] {
        let bad = make_source(&env, &client, 2_000, malicious_price, 10_000);

        let result = client.aggregate();
        assert_eq!(result.price, 100_000_000, "honest median must be unaffected by a minority Byzantine source");
        assert_eq!(result.sources_rejected_deviant, 1, "the lying source must be flagged as deviant");
        assert_eq!(result.sources_used, 4);

        client.remove_source(&bad);
    }
}

/// Property: once Byzantine weight is large enough that filtering it out
/// breaks quorum, the call must fail safely rather than return a number.
#[test]
#[should_panic]
fn invariant_majority_byzantine_disagreement_fails_safely() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);

    let admin = Address::generate(&env);
    let contract_id = env.register(OracleAggregatorContract, ());
    let client = OracleAggregatorContractClient::new(&env, &contract_id);
    // Requires all 5 sources and full weight to agree.
    client.initialize(&config_with(&admin, 5, 10_000, 300, 500));

    for _ in 0..3 {
        make_source(&env, &client, 2_000, 100_000_000, 10_000);
    }
    // Two sources disagree far beyond the band — quorum (5 sources) can no
    // longer be met once they're filtered out.
    make_source(&env, &client, 2_000, 500_000_000, 10_000);
    make_source(&env, &client, 2_000, 500_000_000, 10_000);

    client.aggregate();
}

// ---------------------------------------------------------------------------
// Property: staleness is a hard boundary regardless of how much the price
// itself agrees with everyone else.
// ---------------------------------------------------------------------------

#[test]
fn property_stale_sources_excluded_at_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let max_staleness = 300u64;
    let current_time = 100_000u64;
    env.ledger().set_timestamp(current_time);

    let admin = Address::generate(&env);
    let contract_id = env.register(OracleAggregatorContract, ());
    let client = OracleAggregatorContractClient::new(&env, &contract_id);
    client.initialize(&config_with(&admin, 1, 1, max_staleness, 500));

    // Exactly at the boundary: still fresh (current_time == ts + max_staleness).
    let fresh_boundary = make_source(&env, &client, 5_000, 100_000_000, current_time - max_staleness);
    let result = client.aggregate();
    assert_eq!(result.sources_rejected_stale, 0);
    assert_eq!(result.sources_used, 1);
    client.remove_source(&fresh_boundary);

    // One second past the boundary: must be rejected as stale, even though
    // the price itself is perfectly in agreement with everyone.
    let stale_boundary = make_source(&env, &client, 5_000, 100_000_000, current_time - max_staleness - 1);
    let stale_result = client.try_aggregate();
    assert!(stale_result.is_err(), "sole source past the staleness bound must fail quorum, not silently succeed");
    client.remove_source(&stale_boundary);
}

/// Property: for a sweep of staleness offsets, a source is included iff it
/// is within the staleness bound — independent of its price.
#[test]
fn property_staleness_sweep_matches_expected_inclusion() {
    let env = Env::default();
    env.mock_all_auths();
    let max_staleness = 600u64;
    let current_time = 1_000_000u64;
    env.ledger().set_timestamp(current_time);

    let admin = Address::generate(&env);
    let contract_id = env.register(OracleAggregatorContract, ());
    let client = OracleAggregatorContractClient::new(&env, &contract_id);
    // A permanent, always-fresh anchor source so aggregation never fails
    // quorum outright — we're only checking the *count* rejected as stale.
    client.initialize(&config_with(&admin, 1, 1, max_staleness, 500));
    make_source(&env, &client, 1_000, 100_000_000, current_time);

    for age in [0u64, 300, 599, 600, 601, 900, 10_000] {
        let ts = current_time - age;
        let candidate = make_source(&env, &client, 1_000, 100_000_000, ts);
        let result = client.aggregate();
        let should_be_fresh = age <= max_staleness;
        let expected_rejected = if should_be_fresh { 0 } else { 1 };
        assert_eq!(
            result.sources_rejected_stale, expected_rejected,
            "age {} vs bound {} mismatched freshness expectation",
            age, max_staleness
        );
        client.remove_source(&candidate);
    }
}

// ---------------------------------------------------------------------------
// Property: boundary deviation — a source exactly at max_deviation_bps is
// included, one basis point beyond it is excluded.
// ---------------------------------------------------------------------------

#[test]
fn property_deviation_boundary_inclusion() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);

    let admin = Address::generate(&env);
    let contract_id = env.register(OracleAggregatorContract, ());
    let client = OracleAggregatorContractClient::new(&env, &contract_id);
    let max_deviation_bps: i128 = 500; // 5%
    client.initialize(&config_with(&admin, 1, 1, 300, max_deviation_bps));

    // Two agreeing anchors establish the median at 100_000_000.
    make_source(&env, &client, 4_000, 100_000_000, 10_000);
    make_source(&env, &client, 4_000, 100_000_000, 10_000);

    // Exactly 5% away: 100_000_000 * 1.05 = 105_000_000 -> included.
    let at_boundary = make_source(&env, &client, 2_000, 105_000_000, 10_000);
    let result = client.aggregate();
    assert_eq!(result.sources_rejected_deviant, 0, "a source exactly at the deviation bound must be included");
    client.remove_source(&at_boundary);

    // 5.01% away: 105_100_000 -> excluded.
    let past_boundary = make_source(&env, &client, 2_000, 105_100_000, 10_000);
    let result2 = client.aggregate();
    assert_eq!(result2.sources_rejected_deviant, 1, "a source past the deviation bound must be excluded");
    client.remove_source(&past_boundary);
}

// ---------------------------------------------------------------------------
// Invariant: insufficient quorum always fails safely (never returns a
// price computed from too few / too little weight of sources).
// ---------------------------------------------------------------------------

#[test]
#[should_panic]
fn invariant_insufficient_source_count_fails_safely() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);

    let admin = Address::generate(&env);
    let contract_id = env.register(OracleAggregatorContract, ());
    let client = OracleAggregatorContractClient::new(&env, &contract_id);
    client.initialize(&config_with(&admin, 3, 1, 300, 500));

    make_source(&env, &client, 5_000, 100_000_000, 10_000);
    make_source(&env, &client, 5_000, 100_000_000, 10_000);
    // Only 2 sources registered, quorum requires 3.
    client.aggregate();
}

#[test]
#[should_panic]
fn invariant_insufficient_quorum_weight_fails_safely() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10_000);

    let admin = Address::generate(&env);
    let contract_id = env.register(OracleAggregatorContract, ());
    let client = OracleAggregatorContractClient::new(&env, &contract_id);
    // Needs 9_000 bps of weight present, but sources only add up to 2_000.
    client.initialize(&config_with(&admin, 1, 9_000, 300, 500));

    make_source(&env, &client, 1_000, 100_000_000, 10_000);
    make_source(&env, &client, 1_000, 100_000_000, 10_000);
    client.aggregate();
}

// ---------------------------------------------------------------------------
// Property: decimal normalization never silently overflows or wraps, and
// is exact when scaling up / bounded (<1 unit) when scaling down.
// ---------------------------------------------------------------------------

#[test]
fn property_normalize_checked_exact_and_bounded() {
    let env = Env::default();

    let cases: [(i128, u32, u32, i128); 5] = [
        (1_000_000, 6, 8, 100_000_000),
        (100_000_000, 8, 8, 100_000_000),
        (12_345, 2, 0, 123),           // scaling down truncates toward zero
        (1, 0, 6, 1_000_000),          // scaling up is exact
        (50_000_000_000_000_000_000, 18, 8, 50_000_000),
    ];

    for (price, from_dec, to_dec, expected) in cases.iter() {
        let result = normalize_checked(&env, *price, *from_dec, *to_dec);
        assert_eq!(result, *expected, "normalize_checked({}, {}, {}) mismatched", price, from_dec, to_dec);
    }
}

#[test]
#[should_panic]
fn property_normalize_checked_rejects_overflow_instead_of_wrapping() {
    let env = Env::default();
    // i128::MAX scaled up by 10^30 cannot possibly fit — must panic with
    // ArithmeticError rather than silently wrapping to a bogus small/negative
    // number that downstream logic could mistake for a valid price.
    let _ = normalize_checked(&env, i128::MAX, 0, 30);
}

#[test]
fn property_normalize_checked_noop_when_decimals_equal() {
    let env = Env::default();
    for price in [0i128, 1, -1, 123_456_789, i128::MAX, i128::MIN] {
        assert_eq!(normalize_checked(&env, price, 8, 8), price);
    }
}
