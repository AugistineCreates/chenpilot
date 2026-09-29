#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contractclient, symbol_short,
    Address, Env, Vec,
};
use contract_failure::{fail, unwrap_or_fail, FailureReason};
use pause_state;

// TTL for price snapshot: ~1 day (172_800 ledgers at 5s/ledger)
// Snapshots must be refreshed regularly to maintain price safety
const PRICE_SNAPSHOT_TTL_LEDGERS: u32 = 172_800;

// ---------------------------------------------------------------------------
// Oracle interface
// ---------------------------------------------------------------------------
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    fn get_price(env: Env, asset: Address) -> i128;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    LastSnapshotLedger,
    PriceSnapshot,
    OracleFreshness,
    PriceSequenceHistory,
    CircuitBreaker,
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub oracle: Address,
    pub guarded_asset: Address,
    pub max_intra_ledger_deviation_bps: i128,
    pub min_ledger_gap: u32,
    pub max_oracle_staleness_seconds: u64,
    pub max_consecutive_price_change_bps: i128,
    pub max_oracle_update_gap_seconds: u64,
    pub circuit_breaker_threshold_bps: i128,
    pub circuit_breaker_window_seconds: u64,
}

// ---------------------------------------------------------------------------
// Price snapshot
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceSnapshot {
    pub price: i128,
    pub ledger: u32,
    pub oracle_timestamp: u64,
    pub oracle_sequence: u64,
}

// ---------------------------------------------------------------------------
// Circuit breaker state
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircuitBreakerState {
    pub triggered: bool,
    pub trigger_ledger: u32,
    pub trigger_timestamp: u64,
    pub consecutive_violations: u32,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub oracle: Address,
    pub guarded_asset: Address,
    pub max_intra_ledger_deviation_bps: i128,
    pub min_ledger_gap: u32,
    pub max_oracle_staleness_seconds: u64,
    pub max_consecutive_price_change_bps: i128,
    pub max_oracle_update_gap_seconds: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtCfgUpd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub oracle: Address,
    pub guarded_asset: Address,
    pub max_intra_ledger_deviation_bps: i128,
    pub min_ledger_gap: u32,
    pub max_oracle_staleness_seconds: u64,
    pub max_consecutive_price_change_bps: i128,
    pub max_oracle_update_gap_seconds: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSnapshot {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub price: i128,
    pub oracle_timestamp: u64,
    pub oracle_sequence: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtStalePrc {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub oracle_timestamp: u64,
    pub current_time: u64,
    pub max_staleness: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSeqAttk {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub prev_seq: u64,
    pub new_seq: u64,
    pub price_diff: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtStaleUpd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub prev_timestamp: u64,
    pub current_time: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtPriceSafe {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub snap_price: i128,
    pub current_price: i128,
    pub deviation_bps: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtStaleChk {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub snap_timestamp: u64,
    pub current_time: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtTimEdge {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub snap_ledger: u32,
    pub current_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtFlashBlk {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub snap_price: i128,
    pub current_price: i128,
    pub deviation_bps: i128,
}

#[contract]
pub struct FlashLoanGuardContract;

#[contractimpl]
impl FlashLoanGuardContract {
    pub fn initialize(env: Env, config: Config) {
        if env.storage().instance().has(&DataKey::Config) {
            fail(&env, FailureReason::AlreadyInitialized);
        }
        validate_config(&env, &config);
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(
            &DataKey::CircuitBreaker,
            &CircuitBreakerState {
                triggered: false,
                trigger_ledger: 0,
                trigger_timestamp: 0,
                consecutive_violations: 0,
            },
        );

        env.events().publish(
            (symbol_short!("flg"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                admin: config.admin.clone(),
                oracle: config.oracle.clone(),
                guarded_asset: config.guarded_asset.clone(),
                max_intra_ledger_deviation_bps: config.max_intra_ledger_deviation_bps,
                min_ledger_gap: config.min_ledger_gap,
                max_oracle_staleness_seconds: config.max_oracle_staleness_seconds,
                max_consecutive_price_change_bps: config.max_consecutive_price_change_bps,
                max_oracle_update_gap_seconds: config.max_oracle_update_gap_seconds,
            },
        );
    }

    pub fn update_config(env: Env, config: Config) {
        let current: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        current.admin.require_auth();
        validate_config(&env, &config);
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("flg"), symbol_short!("cfg_upd")),
            EvtCfgUpd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: current.admin.clone(),
                admin: config.admin.clone(),
                oracle: config.oracle.clone(),
                guarded_asset: config.guarded_asset.clone(),
                max_intra_ledger_deviation_bps: config.max_intra_ledger_deviation_bps,
                min_ledger_gap: config.min_ledger_gap,
                max_oracle_staleness_seconds: config.max_oracle_staleness_seconds,
                max_consecutive_price_change_bps: config.max_consecutive_price_change_bps,
                max_oracle_update_gap_seconds: config.max_oracle_update_gap_seconds,
            },
        );
    }

    /// Validate that all external contract addresses in the config are existing contracts.
    /// This prevents hallucinated or fabricated asset/contract addresses from being
    /// accepted into the guard's configuration.
    fn validate_config(env: &Env, config: &Config) {
        if !env.is_contract(config.oracle.clone()) || !env.is_contract(config.guarded_asset.clone()) {
            fail(env, FailureReason::InvalidConfig);
        }
    }

    // ── Emergency pause (see the `pause_state` crate for the standard) ─────────
    //
    // Pausing blocks record_snapshot() — no new price data is accepted
    // during an incident, which also means assert_price_safe() will start
    // failing on staleness once the existing snapshot ages out. That's
    // intentional: flash_loan_guard's whole purpose is gating on fresh,
    // validated prices, so refusing to accept new snapshots is the correct
    // emergency posture, not a bug.

    /// Pause the guard. Blocks `record_snapshot()` until `unpause()`.
    /// Trust boundary: Config.admin only.
    pub fn pause(env: Env) {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        config.admin.require_auth();
        pause_state::pause(&env, config.admin);
    }

    /// Unpause the guard, re-enabling `record_snapshot()`.
    /// Trust boundary: Config.admin only.
    pub fn unpause(env: Env) {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        config.admin.require_auth();
        pause_state::unpause(&env, config.admin);
    }

    /// Whether the guard is currently paused. Safe to call from another
    /// contract via a `#[contractclient]` trait for cross-contract pause
    /// checks — see `pause_state`'s module doc.
    pub fn is_paused(env: Env) -> bool {
        pause_state::is_paused(&env)
    }

    /// Update circuit breaker state and auto-release if window expired
    fn update_circuit_breaker(env: Env, current_ledger: u32, current_time: u64) {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        let mut cb: CircuitBreakerState = env
            .storage()
            .instance()
            .get(&DataKey::CircuitBreaker)
            .unwrap_or(CircuitBreakerState {
                triggered: false,
                trigger_ledger: 0,
                trigger_timestamp: 0,
                consecutive_violations: 0,
            });

        if cb.triggered {
            if current_time > cb.trigger_timestamp + config.circuit_breaker_window_seconds {
                cb.triggered = false;
                cb.trigger_ledger = 0;
                cb.trigger_timestamp = 0;
                cb.consecutive_violations = 0;
                env.storage().instance().set(&DataKey::CircuitBreaker, &cb);
                env.events().publish((symbol_short!("CbRst"),), (current_ledger, current_time));
            }
        }
    }

    pub fn record_snapshot(env: Env, oracle_timestamp: u64, oracle_sequence: u64) {
        pause_state::require_not_paused(&env);
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        let current_ledger = env.ledger().sequence();
        let current_time = env.ledger().timestamp();

        // Check circuit breaker state first
        self::update_circuit_breaker(&env, current_ledger, current_time);
        let cb: CircuitBreakerState = env
            .storage()
            .instance()
            .get(&DataKey::CircuitBreaker)
            .unwrap_or(CircuitBreakerState {
                triggered: false,
                trigger_ledger: 0,
                trigger_timestamp: 0,
                consecutive_violations: 0,
            });
        if cb.triggered {
            fail(&env, FailureReason::CircuitBreakerActive);
        }

        // Oracle freshness check
        if current_time > oracle_timestamp + config.max_oracle_staleness_seconds {
            env.events().publish(
                (symbol_short!("flg"), symbol_short!("stale_prc")),
                EvtStalePrc {
                    version: 1,
                    ledger: current_ledger,
                    actor: config.admin.clone(),
                    oracle_timestamp,
                    current_time,
                    max_staleness: config.max_oracle_staleness_seconds,
                },
            );
            fail(&env, FailureReason::OracleDataStale);
        }

        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let price = oracle.get_price(&config.guarded_asset);

        // Fetch last N snapshots for circuit breaker validation
        let price_history: Vec<PriceSnapshot> = env
            .storage()
            .instance()
            .get(&DataKey::PriceSequenceHistory)
            .unwrap_or(Vec::from_array(&env, []));

        if let Some(snap) = env
            .storage()
            .instance()
            .get::<DataKey, PriceSnapshot>(&DataKey::PriceSnapshot)
        {
            if current_ledger < snap.ledger + config.min_ledger_gap {
                fail(&env, FailureReason::SnapshotTooRecent);
            }

            if oracle_sequence <= snap.oracle_sequence {
                fail(&env, FailureReason::OracleSequenceNotIncreasing);
            }

            let price_diff = if snap.price > 0 {
                let diff = if snap.price > price {
                    snap.price - price
                } else {
                    price - snap.price
                };
                diff.checked_mul(10_000)
                    .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError))
                    .checked_div(snap.price)
                    .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError))
            } else {
                0
            };

            if price_diff > config.max_consecutive_price_change_bps {
                env.events().publish(
                    (symbol_short!("flg"), symbol_short!("seq_attk")),
                    EvtSeqAttk {
                        version: 1,
                        ledger: current_ledger,
                        actor: config.admin.clone(),
                        prev_seq: snap.oracle_sequence,
                        new_seq: oracle_sequence,
                        price_diff,
                    },
                );
                fail(&env, FailureReason::ConsecutivePriceChangeExceedsThreshold);
            }

            if current_time > snap.oracle_timestamp + config.max_oracle_update_gap_seconds {
                env.events().publish(
                    (symbol_short!("flg"), symbol_short!("stale_upd")),
                    EvtStaleUpd {
                        version: 1,
                        ledger: current_ledger,
                        actor: config.admin.clone(),
                        prev_timestamp: snap.oracle_timestamp,
                        current_time,
                    },
                );
                fail(&env, FailureReason::OracleUpdateGapExceeded);
            }

            // Circuit breaker: count consecutive violations from history
            let mut violations = cb.consecutive_violations;
            let mut should_trigger = false;
            if price_diff > config.circuit_breaker_threshold_bps {
                violations += 1;
                if violations >= 3 {
                    should_trigger = true;
                }
            } else {
                violations = 0;
            }

            if should_trigger {
                env.storage().instance().set(
                    &DataKey::CircuitBreaker,
                    &CircuitBreakerState {
                        triggered: true,
                        trigger_ledger: current_ledger,
                        trigger_timestamp: current_time,
                        consecutive_violations: violations,
                    },
                );
                env.events().publish(
                    (symbol_short!("CbTrip"),),
                    (price_diff, violations, current_ledger),
                );
                fail(&env, FailureReason::CircuitBreakerTripped);
            } else {
                env.storage().instance().set(
                    &DataKey::CircuitBreaker,
                    &CircuitBreakerState {
                        triggered: false,
                        trigger_ledger: 0,
                        trigger_timestamp: 0,
                        consecutive_violations: violations,
                    },
                );
            }
        }

        // Update price history (keep last 10)
        let mut new_history = Vec::from_array(&env, []);
        if price_history.len() >= 10 {
            for i in 1..price_history.len() {
                new_history.push_back(
                    unwrap_or_fail(&env, price_history.get(i), FailureReason::StorageValueMissing).clone(),
                );
            }
        } else {
            for item in price_history.iter() {
                new_history.push_back(item.clone());
            }
        }
        new_history.push_back(PriceSnapshot {
            price,
            ledger: current_ledger,
            oracle_timestamp,
            oracle_sequence,
        });
        env.storage().instance().set(&DataKey::PriceSequenceHistory, &new_history);

        // Store snapshot with TTL to ensure it must be refreshed regularly
        env.storage().instance().set_with_ttl(
            &DataKey::PriceSnapshot,
            &PriceSnapshot {
                price,
                ledger: current_ledger,
                oracle_timestamp,
                oracle_sequence,
            },
        );

        env.events().publish(
            (symbol_short!("flg"), symbol_short!("snapshot")),
            EvtSnapshot {
                version: 1,
                ledger: current_ledger,
                actor: config.admin.clone(),
                price,
                oracle_timestamp,
                oracle_sequence,
            },
        );
    }

    pub fn assert_price_safe(env: Env) -> i128 {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        let current_time = env.ledger().timestamp();

        let snap: PriceSnapshot = env
            .storage()
            .instance()
            .get(&DataKey::PriceSnapshot)
            .unwrap_or_else(|| fail(&env, FailureReason::NotFound));

        let current_ledger = env.ledger().sequence();

        if current_ledger == snap.ledger {
            fail(&env, FailureReason::SnapshotSameLedger);
        }

        if current_time > snap.oracle_timestamp + config.max_oracle_staleness_seconds {
            env.events().publish(
                (symbol_short!("flg"), symbol_short!("stale_chk")),
                EvtStaleChk {
                    version: 1,
                    ledger: current_ledger,
                    actor: config.admin.clone(),
                    snap_timestamp: snap.oracle_timestamp,
                    current_time,
                },
            );
            fail(&env, FailureReason::OracleDataStale);
        }

        if current_ledger > snap.ledger + (config.max_oracle_update_gap_seconds / 5) as u32 {
            env.events().publish(
                (symbol_short!("flg"), symbol_short!("tim_edge")),
                EvtTimEdge {
                    version: 1,
                    ledger: current_ledger,
                    actor: config.admin.clone(),
                    snap_ledger: snap.ledger,
                    current_ledger,
                },
            );
            fail(&env, FailureReason::SnapshotTooOld);
        }

        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let current_price = oracle.get_price(&config.guarded_asset);

        let diff = if current_price > snap.price {
            current_price - snap.price
        } else {
            snap.price - current_price
        };

        let deviation_bps = diff
            .checked_mul(10_000)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError))
            .checked_div(snap.price)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));

        if deviation_bps > config.max_intra_ledger_deviation_bps {
            env.events().publish(
                (symbol_short!("flg"), symbol_short!("flash_blk")),
                EvtFlashBlk {
                    version: 1,
                    ledger: current_ledger,
                    actor: config.admin.clone(),
                    snap_price: snap.price,
                    current_price,
                    deviation_bps,
                },
            );
            fail(&env, FailureReason::PriceDeviationExceedsThreshold);
        }

        env.events().publish(
            (symbol_short!("flg"), symbol_short!("price_safe")),
            EvtPriceSafe {
                version: 1,
                ledger: current_ledger,
                actor: config.admin.clone(),
                snap_price: snap.price,
                current_price,
                deviation_bps,
            },
        );

        current_price
    }

    pub fn get_snapshot(env: Env) -> Option<PriceSnapshot> {
        env.storage().instance().get(&DataKey::PriceSnapshot)
    }

    pub fn get_config(env: Env) -> Config {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized))
    }

    pub fn get_circuit_breaker(env: Env) -> CircuitBreakerState {
        env.storage().instance()
            .get(&DataKey::CircuitBreaker)
            .unwrap_or(CircuitBreakerState {
                triggered: false,
                trigger_ledger: 0,
                trigger_timestamp: 0,
                consecutive_violations: 0,
            })
    }
}

mod test;
mod test_freshness;
mod test_invariants;
mod test_pause;
