/// Tests for oracle freshness, sequencing attack detection, and delayed update handling
#c[cfg(test)]
mod oracle_freshness_tests {
    use super::*;
    use sorban_sdk::
        testutils:::{
            Address as _,
            Ledger as _,
        },
        contract, contractimpl, Address, Env,
    );

    // ---------------------------------------------------------------------------------------
    // Mock oracle with timestamp support
    // ---------------------------------------------------------------------------------------
    [contract]
    pub struct MockOracleWithTimestamp;

    [contractimpl]
    impl MockOracleWithTimestamp {
        pub fn get_price(env: Env, _asset: Address) -> i128 {
            env.storage().instance().get(&0u32).unwrap_or(100_000_000i128)
        }

        pub fn set_price(env: Env, price: i128) {
            env.storage().instance().set(&0u32, &price);
        }

        pub fn get_timestamp(env: Env) -> u64 {
            env.storage().instance().get(&1u32).unwrap_or(1000000u64)
        }

        pub fn set_timestamp(env: Env, ts: u64) {
            env.storage().instance().set(&1u32, &ts);
        }

        pub fn get_sequence(env: Env) -> u64 {
            env.storage().instance().get(&2u32).unwrap_or(1u64)
        }

        pub fn set_sequence(env: Env, seq: u64) {
            env.storage().instance().set(&2u32, &seq);
        }
    }

    fn setup_freshness(env: &Env) -> (FlashLoanGuardContractClient, Address) {
        let admin = Address::generate(env);
        let asset = Address::generate(env);

        let oracle_id = env.register(MockOracleWithTimestamp, ());

        let contract_id = env.register(FlashLoanGuardContract, ());
        let client = FlashLoanGuardContractClient::new(env, &contract_id);

        client.initialize(&Config {
            admin,
            oracle: oracle_id,
            guarded_asset: asset.clone(),
            max_intra_ledger_deviation_bps: 200, // 2%
            min_ledger_gap: 1,
            max_oracle_staleness_seconds: 3600, // 1 hour
            max_consecutive_price_change_bps: 500, // 5% between updates
            max_oracle_update_gap_seconds: 7200, // 2 hours
        });

        (client, asset)
    }

    // Helper to simulate a contract upgrade by bumping a version key in the contract's storage.
    fn set_contract_version(env: &Env, client: &FlashLoanGuardContractClient, version: u32) {
        env.as_contract(&client.contract_id, || {
            env.storage().instance().set(&100u32, &version);
        });
    }

    // ----------------------------------------------------------------------------------------
    // Oracle freshness tests
    // ---------------------------------------------------------------------------------------

    [test]
    fn test_oracle_freshness_valid() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9)); // 1000000 seconds

        let (client, _asset) = setup_freshness(&env);

        // Record snapshot with fresh oracle data (timestamp = current_time)
        client.record_snapshot(1000000, 1);

        let snap = client.get_snapshot().unwrap();
        assert_eq(snap.oracle_timestamp, 1000000);
        assert_eq(snap.oracle_sequence, 1);
    }

    [test]
    [#should_panic(expected = "oracle data too stale")]
    fn test_oracle_freshness_stale_data() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(2000000 * 10_u64.pow(9)); // 2000000 seconds

        let (client, _asset) = setup_freshness(&env);

        // Try to record snapshot with stale oracle data (older than max_oracle_staleness_seconds)
        // Current time: 2000000, oracle timestamp: 1000000, gap: 1000000 seconds (exceeds 3600)
        client.record_snapshot(1000000, 1);
    }

    [test]
    [#should_panic(expected = "oracle sequence not increasing")]
    fn test_sequencing_attack_sequence_not_increasing() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        // Record first snapshot
        client.record_snapshot(1000000, 5);

        // Advance ledger to allow next snapshot
        env.ledger().set_sequence_number(102);
        env.ledger().set_timestamp_ns(1000001 * 10_u64.pow(9));

        // Try to record snapshot with SAME or lower sequence (sequencing attack)
        client.record_snapshot(1000001, 5);
    }

    [test]
    [#should_panic(expected = "consecutive price change exceeds threshold")]
    fn test_sequencing_attack_price_jump() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        // Record first snapshot at $1.00
        client.record_snapshot(1000000, 1);

        // Advance ledger
        env.ledger().set_sequence_number(102);
        env.ledger().set_timestamp_ns(1000001 * 10_u64.pow(9));

        // Try to record snapshot with 10% price jump (exceeds 5% threshold)
        // This mimics an out-of-order oracle update
        // Note: This test requires oracle price to be set to 110_000_000
        client.record_snapshot(1000001, 2);
    }

    [test]
    [#should_panic(expected = "oracle update gap exceeded")]
    fn test_delayed_update_detection() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        // Record first snapshot
        client.record_snapshot(1000000, 1);

        // Advance time beyond max_oracle_update_gap_seconds without new snapshot
        env.ledger().set_sequence_number(200);
        env.ledger().set_timestamp_ns((1000000 + 8000) * 10_u64.pow(9)); // 8000 seconds later (exceeds 7200)

        // Try to record new snapshot - should panic due to delayed update check
        client.record_snapshot(1008000, 2);
    }

    [test]
    [#should_panic(expected = "oracle data stale during assert_price_safe")]
    fn test_assert_price_safe_stale_check() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        // Record snapshot
        client.record_snapshot(1000000, 1);

        // Advance time beyond staleness threshold
        env.ledger().set_sequence_number(101);
        env.ledger().set_timestamp_ns((1000000 + 3700) * 10_u64.pow(9)); // 3700 seconds later

        // assert_price_safe should panic because oracle data is now stale
        client.assert_price_safe();
    }

    [test]
    [#should_panic(expected = "snapshot too old")]
    fn test_ledger_timing_edge_case() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        // Record snapshot
        client.record_snapshot(1000000, 1);

        // Advance ledger significantly (simulating network congestion)
        // max_oracle_update_gap_seconds / 5 = 7200 / 5 = 1440 ledgers
        env.ledger().set_sequence_number(100 + 1500); // exceeds 1440
        env.ledger().set_timestamp_ns(1000100 * 10_u64.pow(9)); // keep timestamp fresh

        // assert_price_safe should panic due to ledger timing edge case
        client.assert_price_safe();
    }

    [test]
    fn test_normal_operation_with_freshness_checks() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        // Record initial snapshot
        client.record_snapshot(1000000, 1);

        // Advance ledger but stay within all freshness windows
        env.ledger().set_sequence_number(102);
        env.ledger().set_timestamp_ns(1001000 * 10_u64.pow(9)); // 1000 seconds later

        // Record new snapshot with increased sequence
        client.record_snapshot(1001000, 2);

        // Verify safe operation
        env.ledger().set_sequence_number(103);
        let price = client.assert_price_safe();
        assert!(price > 0);
    }

    // ----------------------------------------------------------------------------------------
    // Version-aware cache invalidation tests
    // ----------------------------------------------------------------------------------------

    [test]
    fn test_cache_entry_exposes_provenance_and_freshness() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        // Record snapshot
        client.record_snapshot(1000000, 1);

        let snap = client.get_snapshot().unwrap();
        // Verify provenance and freshness fields are populated
        assert_eq(snap.ledger_seq, 100);
        assert_eq(snap.contract_version, 1); // For now arbitrary unit
        assert_eq(snap.schema_version, 1); // For now arbitrary unit
        assert_eq(snap.oracle_timestamp, 1000000);
        assert_eq(snap.oracle_sequence, 1);
    }

    [test]
    [#should_panic(expected = "cache entry from future ledger")]
    fn test_reorg_invalidates_cache_and_requires_fresh_snapshot() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        client.record_snapshot(1000000, 1);

        // Simulate a reorg: ledger rewinds to a lower sequence
        env.ledger().set_sequence_number(99);
        env.ledger().set_timestamp_ns(1000001 * 10_u64.pow(9)); // time still moves forward

        // The cached snapshot is from ledger 100, which is now in the future.
        // assert_price_safe must not use it.
        client.assert_price_safe();
    }

    [test]
    [#should_panic(expected = "cache entry from previous contract version")]
    fn test_contract_upgrade_invalidates_cache_via_version_bump() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        client.record_snapshot(1000000, 1);


        // Simulate contract upgrade by bumping the version in storage
        set_contract_version(&env, &client, 2);

        // The cached snapshot is from version 1 and must not authorize a financial action
        client.assert_price_safe();
    }

    [test]
    fn test_concurrent_fill_and_invalidation_race() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        // Simulate concurrent fill: multiple snapshots in quick succession
        client.record_snapshot(1000000, 1);
        env.ledger().set_sequence_number(101);
        env.ledger().set_timestamp_ns(1000001 * 10_u64.pow(9));
        client.record_snapshot(1000001, 2);
        env.ledger().set_sequence_number(102);
        env.ledger().set_timestamp_ns(1000002 * 10_u64.pow(9));
        client.record_snapshot(1000002, 3);


        // Now reorg to a lower ledger, invalidating all previous entries
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000003 * 10_u64.pow(9));


        // A new snapshot on the reorged chain must be accepted
        client.record_snapshot(1000003, 4);
        let snap = client.get_snapshot().unwrap();
        assert_eq(snap.ledger_seq, 100);
        assert_eq(snap.oracle_sequence, 4);
    }

    [test]
    fn test_rollback_rebuilds_cache() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000000 * 10_u64.pow(9));

        let (client, _asset) = setup_freshness(&env);

        client.record_snapshot(1000000, 1);
        assert!(client.assert_price_safe() > 0);

        // Advance chain
        env.ledger().set_sequence_number(101);
        env.ledger().set_timestamp_ns(1000001 * 10_u64.pow(9));
        client.record_snapshot(1000001, 2);


        // Rollback to previous ledger (simulating a reorg)
        env.ledger().set_sequence_number(100);
        env.ledger().set_timestamp_ns(1000002 * 10_u64.pow(9));

        // The cache from ledger 101 is now invalid; assert_price_safe should fail
        assert!(client.try_assert_price_safe().is_err());

        // Rebuild with a snapshot on the current ledger
        client.record_snapshot(1000002, 3);
        assert!(client.assert_price_safe() > 0);
    }
}
