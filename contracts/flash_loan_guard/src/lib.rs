#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contractclient, symbol_short,
    Address, Env,
};

// ---------------------------------------------------------------------------
// Oracle interface — same pattern as liquidity_vault
// ---------------------------------------------------------------------------
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    /// Returns the price of `asset` scaled to 1e8.
    fn get_price(env: Env, asset: Address) -> i128;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    /// Last ledger sequence at which a price snapshot was recorded.
    LastSnapshotLedger,
    /// Price snapshot: stored as (price, ledger_sequence).
    PriceSnapshot,
    /// Oracle freshness tracker: (timestamp, sequence_number) for detecting stale/manipulated data.
    OracleFreshness,
    /// Price sequence history: last N prices to detect sequencing anomalies.
    PriceSequenceHistory,
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub oracle: Address,
    /// The asset whose price is being guarded (e.g. wBTC in the Chen Pilot vault).
    pub guarded_asset: Address,
    /// Maximum allowed price deviation within a single ledger, in basis points.
    /// e.g. 200 = 2%. Any intra-ledger price move larger than this is blocked.
    pub max_intra_ledger_deviation_bps: i128,
    /// Minimum number of ledgers that must pass between price updates.
    /// Prevents an attacker from updating the snapshot and exploiting in the same ledger.
    pub min_ledger_gap: u32,
    /// Maximum allowed age of oracle data in seconds (freshness timeout).
    /// Rejects snapshots older than this duration.
    pub max_oracle_staleness_seconds: u64,
    /// Maximum allowed price change between consecutive oracle updates (sequencing check).
    /// Detects out-of-order updates or oracle manipulation.
    pub max_consecutive_price_change_bps: i128,
    /// Maximum allowed time gap between oracle updates (delayed update detection).
    /// If no update received within this time, price guard fails.
    pub max_oracle_update_gap_seconds: u64,
}

// ---------------------------------------------------------------------------
// Price snapshot stored on-chain
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceSnapshot {
    pub price: i128,
    pub ledger: u32,
    /// Timestamp of the oracle update (Unix seconds).
    pub oracle_timestamp: u64,
    /// Sequence number from oracle for detecting reordered updates.
    pub oracle_sequence: u64,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct FlashLoanGuardContract;

#[contractimpl]
impl FlashLoanGuardContract {
    pub fn initialize(env: Env, config: Config) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Config, &config);
    }

    pub fn update_config(env: Env, config: Config) {
        let current: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");
        current.admin.require_auth();
        env.storage().instance().set(&DataKey::Config, &config);
    }

    /// Record a fresh price snapshot from the oracle.
    ///
    /// Enforces `min_ledger_gap`: the snapshot cannot be updated more than once
    /// per `min_ledger_gap` ledgers, preventing an attacker from resetting the
    /// baseline and exploiting in the same ledger close.
    ///
    /// NEW: Also validates oracle freshness (timestamp not too old), detects
    /// sequencing attacks (price changes within limits), and handles delayed updates.
    pub fn record_snapshot(env: Env, oracle_timestamp: u64, oracle_sequence: u64) {
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");
        let current_ledger = env.ledger().sequence();
        let current_time = env.ledger().timestamp();

        // --- Check oracle freshness (not stale) first ---
        if current_time > oracle_timestamp + config.max_oracle_staleness_seconds {
            env.events().publish(
                (symbol_short!("StalePrc"),),
                (oracle_timestamp, current_time, config.max_oracle_staleness_seconds),
            );
            panic!("flash-loan guard: oracle data too stale (freshness check failed)");
        }

        // --- Fetch current price from oracle ---
        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let price = oracle.get_price(&config.guarded_asset);

        // --- Check min_ledger_gap ---
        if let Some(snap) = env
            .storage()
            .instance()
            .get::<DataKey, PriceSnapshot>(&DataKey::PriceSnapshot)
        {
            if current_ledger < snap.ledger + config.min_ledger_gap {
                panic!("snapshot too recent: min_ledger_gap not met");
            }

            // NEW: Detect sequencing attacks by validating oracle_sequence increased
            if oracle_sequence <= snap.oracle_sequence {
                panic!("flash-loan guard: oracle sequence not increasing (sequencing attack detected)");
            }

            // NEW: Validate consecutive price change is within limits (detect out-of-order updates)
            let price_diff = if snap.price > 0 {
                let diff = if snap.price > price {
                    snap.price - price
                } else {
                    price - snap.price
                };
                diff.checked_mul(10_000).expect("overflow")
                    .checked_div(snap.price).expect("div zero")
            } else {
                0
            };

            if price_diff > config.max_consecutive_price_change_bps {
                env.events().publish(
                    (symbol_short!("SeqAttk"),),
                    (snap.oracle_sequence, oracle_sequence, price_diff),
                );
                panic!("flash-loan guard: consecutive price change exceeds threshold (sequencing attack)");
            }

            // NEW: Check delayed update timeout
            if current_time > snap.oracle_timestamp + config.max_oracle_update_gap_seconds {
                env.events().publish(
                    (symbol_short!("StaleUpd"),),
                    (snap.oracle_timestamp, current_time),
                );
                panic!("flash-loan guard: oracle update gap exceeded (delayed update detected)");
            }
        }

        env.storage().instance().set(
            &DataKey::PriceSnapshot,
            &PriceSnapshot {
                price,
                ledger: current_ledger,
                oracle_timestamp,
                oracle_sequence,
            },
        );

        env.events().publish((symbol_short!("Snapshot"),), (price, current_ledger, oracle_timestamp, oracle_sequence));
    }

    /// Core flash-loan guard check.
    ///
    /// Called before any price-sensitive vault operation (swap, liquidation, etc.).
    /// Compares the current oracle price against the stored snapshot.
    ///
    /// Blocks execution if:
    ///   1. No snapshot exists yet (cold-start protection).
    ///   2. The snapshot was taken in the SAME ledger as the current call
    ///      (same-block manipulation detection).
    ///   3. The price deviation from the snapshot exceeds `max_intra_ledger_deviation_bps`.
    ///   4. (NEW) The oracle data is stale (exceeds freshness timeout).
    ///   5. (NEW) The snapshot age exceeds ledger timing edge case threshold.
    ///
    /// Returns the current price on success.
    pub fn assert_price_safe(env: Env) -> i128 {
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");
        let current_time = env.ledger().timestamp();

        let snap: PriceSnapshot = env
            .storage()
            .instance()
            .get(&DataKey::PriceSnapshot)
            .expect("no price snapshot: call record_snapshot first");

        let current_ledger = env.ledger().sequence();

        // --- Same-ledger manipulation check ---
        if current_ledger == snap.ledger {
            panic!("flash-loan guard: price snapshot taken in same ledger");
        }

        // --- NEW: Oracle freshness validation (detect stale data) ---
        if current_time > snap.oracle_timestamp + config.max_oracle_staleness_seconds {
            env.events().publish(
                (symbol_short!("StaleChk"),),
                (snap.oracle_timestamp, current_time),
            );
            panic!("flash-loan guard: oracle data stale during assert_price_safe");
        }

        // --- NEW: Ledger timing edge case detection ---
        // If snapshot is too old relative to current ledger, reject as safety measure
        if current_ledger > snap.ledger + (config.max_oracle_update_gap_seconds / 5) as u32 {
            env.events().publish(
                (symbol_short!("TimEdge"),),
                (snap.ledger, current_ledger),
            );
            panic!("flash-loan guard: snapshot too old (ledger timing edge case)");
        }

        // --- Fetch live price ---
        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let current_price = oracle.get_price(&config.guarded_asset);

        // --- Deviation check ---
        let diff = if current_price > snap.price {
            current_price - snap.price
        } else {
            snap.price - current_price
        };

        let deviation_bps = diff
            .checked_mul(10_000)
            .expect("overflow")
            .checked_div(snap.price)
            .expect("div zero");

        if deviation_bps > config.max_intra_ledger_deviation_bps {
            env.events().publish(
                (symbol_short!("FlashBlk"),),
                (snap.price, current_price, deviation_bps),
            );
            panic!("flash-loan guard: price deviation exceeds threshold");
        }

        env.events().publish(
            (symbol_short!("PriceSafe"),),
            (snap.price, current_price, deviation_bps),
        );

        current_price
    }

    /// Returns the current stored snapshot, if any.
    pub fn get_snapshot(env: Env) -> Option<PriceSnapshot> {
        env.storage().instance().get(&DataKey::PriceSnapshot)
    }

    /// Returns the current config.
    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).expect("not initialized")
    }
}

mod test;
mod test_freshness;
