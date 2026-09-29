#![no_std]
//! # Oracle Aggregator
//!
//! Quorum-based aggregation across independent price sources for a single
//! guarded asset. A single fresh oracle read is not trusted on its own: this
//! contract only produces a price when enough independently-weighted sources
//! agree, within a bounded staleness window and a bounded deviation band.
//!
//! Design summary (see README.md for the full write-up):
//! - Source identity and per-source weight are governance-controlled
//!   (`add_source` / `update_source` / `remove_source`, all admin-gated).
//! - `aggregate()` pulls a reading from every enabled source using a
//!   *fault-tolerant* cross-contract call (`try_get_price`), so one
//!   reverting/unreachable/malicious source cannot DoS the whole
//!   aggregation — it is simply excluded and counted.
//! - Readings are normalized to a common decimal base with checked
//!   arithmetic (never silently overflow, never silently truncate in an
//!   unbounded way).
//! - A weighted median is computed twice: once over all fresh readings
//!   (a median already tolerates up to just under half the weight being
//!   Byzantine), and once more after excluding any source whose reading
//!   deviates from that preliminary median by more than
//!   `max_deviation_bps` ("bounded disagreement"). This bounds how far a
//!   single malicious-but-in-quorum source can pull the result before it is
//!   filtered out on the next call.
//! - Quorum (both source count and total weight) is re-checked after
//!   deviation filtering. If quorum cannot be met — too few sources, too
//!   stale, or too much disagreement — the call fails loudly
//!   (`InsufficientQuorum(Weight)` / `ExcessiveSourceDisagreement`) rather
//!   than silently returning a degraded or biased number. That failure
//!   *is* the safe degraded behavior: consumers must not receive a price
//!   they cannot trust.
//! - `get_latest()` gives consumers a cheap, read-only path that reuses the
//!   last successful aggregate only if it is still within the staleness
//!   bound — otherwise it fails rather than serving a stale cached value.

use contract_failure::{fail, require, unwrap_or_fail, FailureReason};
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Env, Vec,
};

/// Upper bound on the number of registered sources. Keeps the O(n^2)
/// selection sort and the u64 bitmask used during aggregation both cheap
/// and well-defined, and keeps governance's source list auditable.
const MAX_SOURCES: u32 = 32;

/// Basis-point denominator (100.00%).
const BPS_DENOMINATOR: u32 = 10_000;

// ---------------------------------------------------------------------------
// Oracle source interface
// ---------------------------------------------------------------------------

/// A single reading from a source. Sources are expected to be scoped to one
/// asset already (mirrors the existing `por_validator` / `flash_loan_guard`
/// convention of single-asset-scoped contracts), so no asset parameter.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceReading {
    pub price: i128,
    pub decimals: u32,
    pub timestamp: u64,
}

#[contractclient(name = "OracleSourceClient")]
pub trait OracleSourceTrait {
    fn get_price(env: Env) -> SourceReading;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    SourceList,
    Source(Address),
    LastAggregate,
}

/// Governance-controlled registration for one source.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceInfo {
    pub source: Address,
    /// Governance-assigned weight, in basis points (1..=10_000). Used both
    /// as the weighting for the median and as the unit for quorum-by-weight.
    pub weight_bps: u32,
    /// Decimals this source reports its price in; normalized internally.
    pub decimals: u32,
    /// Sources can be disabled without losing their history/weight record —
    /// useful for temporarily benching a misbehaving source.
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AggregateConfig {
    pub admin: Address,
    /// Minimum number of fresh, in-band sources required to produce a price.
    pub min_quorum_sources: u32,
    /// Minimum total weight (bps) of fresh, in-band sources required.
    pub min_quorum_weight_bps: u32,
    /// A reading older than this (relative to ledger time) is excluded.
    pub max_staleness_seconds: u64,
    /// Max allowed |price - median| / median, in bps, for a source to be
    /// considered in-band on the second pass.
    pub max_deviation_bps: i128,
    /// Decimals the aggregated price is normalized to and reported in.
    pub output_decimals: u32,
}

/// Weighted, normalized reading used internally for the median computation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WeightedReading {
    pub price: i128,
    pub weight_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AggregateResult {
    pub price: i128,
    pub decimals: u32,
    pub timestamp: u64,
    pub sources_considered: u32,
    pub sources_used: u32,
    pub total_weight_bps: u32,
    pub sources_rejected_unavailable: u32,
    pub sources_rejected_stale: u32,
    pub sources_rejected_invalid: u32,
    pub sources_rejected_deviant: u32,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub min_quorum_sources: u32,
    pub min_quorum_weight_bps: u32,
    pub max_staleness_seconds: u64,
    pub max_deviation_bps: i128,
    pub output_decimals: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtCfgUpd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub min_quorum_sources: u32,
    pub min_quorum_weight_bps: u32,
    pub max_staleness_seconds: u64,
    pub max_deviation_bps: i128,
    pub output_decimals: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSrcAdd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub source: Address,
    pub weight_bps: u32,
    pub decimals: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSrcUpd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub source: Address,
    pub weight_bps: u32,
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSrcRm {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub source: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtAggreg {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub price: i128,
    pub sources_used: u32,
    pub total_weight_bps: u32,
    pub sources_rejected_deviant: u32,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct OracleAggregatorContract;

#[contractimpl]
impl OracleAggregatorContract {
    pub fn initialize(env: Env, config: AggregateConfig) {
        if env.storage().instance().has(&DataKey::Config) {
            fail(&env, FailureReason::AlreadyInitialized);
        }
        validate_config(&env, &config);

        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .set(&DataKey::SourceList, &Vec::<Address>::new(&env));

        env.events().publish(
            (symbol_short!("oragg"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                admin: config.admin.clone(),
                min_quorum_sources: config.min_quorum_sources,
                min_quorum_weight_bps: config.min_quorum_weight_bps,
                max_staleness_seconds: config.max_staleness_seconds,
                max_deviation_bps: config.max_deviation_bps,
                output_decimals: config.output_decimals,
            },
        );
    }

    /// Governance-only: replace the whole config (including, if desired,
    /// transferring admin — mirrors the `update_config` pattern used by
    /// `por_validator` / `flash_loan_guard`).
    pub fn update_config(env: Env, config: AggregateConfig) {
        let current = load_config(&env);
        current.admin.require_auth();
        validate_config(&env, &config);

        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("oragg"), symbol_short!("cfg_upd")),
            EvtCfgUpd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: current.admin.clone(),
                admin: config.admin.clone(),
                min_quorum_sources: config.min_quorum_sources,
                min_quorum_weight_bps: config.min_quorum_weight_bps,
                max_staleness_seconds: config.max_staleness_seconds,
                max_deviation_bps: config.max_deviation_bps,
                output_decimals: config.output_decimals,
            },
        );
    }

    /// Governance-only: register a new source with its weight and decimals.
    pub fn add_source(env: Env, source: Address, weight_bps: u32, decimals: u32) {
        let config = load_config(&env);
        config.admin.require_auth();
        require(
            &env,
            weight_bps > 0 && weight_bps <= BPS_DENOMINATOR,
            FailureReason::InvalidWeight,
        );

        let key = DataKey::Source(source.clone());
        require(
            &env,
            !env.storage().instance().has(&key),
            FailureReason::SourceAlreadyRegistered,
        );

        let mut list = get_source_list(&env);
        require(&env, list.len() < MAX_SOURCES, FailureReason::TooManySources);
        list.push_back(source.clone());
        env.storage().instance().set(&DataKey::SourceList, &list);

        let info = SourceInfo {
            source: source.clone(),
            weight_bps,
            decimals,
            enabled: true,
        };
        env.storage().instance().set(&key, &info);

        env.events().publish(
            (symbol_short!("oragg"), symbol_short!("src_add")),
            EvtSrcAdd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                source,
                weight_bps,
                decimals,
            },
        );
    }

    /// Governance-only: change a registered source's weight and/or enabled
    /// flag. Disabling a source keeps its record (useful for benching a
    /// misbehaving/Byzantine source without losing audit history).
    pub fn update_source(env: Env, source: Address, weight_bps: u32, enabled: bool) {
        let config = load_config(&env);
        config.admin.require_auth();
        require(
            &env,
            weight_bps > 0 && weight_bps <= BPS_DENOMINATOR,
            FailureReason::InvalidWeight,
        );

        let key = DataKey::Source(source.clone());
        let mut info: SourceInfo = unwrap_or_fail(&env, env.storage().instance().get(&key), FailureReason::SourceNotRegistered);
        info.weight_bps = weight_bps;
        info.enabled = enabled;
        env.storage().instance().set(&key, &info);

        env.events().publish(
            (symbol_short!("oragg"), symbol_short!("src_upd")),
            EvtSrcUpd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                source,
                weight_bps,
                enabled,
            },
        );
    }

    /// Governance-only: remove a source entirely.
    pub fn remove_source(env: Env, source: Address) {
        let config = load_config(&env);
        config.admin.require_auth();

        let key = DataKey::Source(source.clone());
        require(
            &env,
            env.storage().instance().has(&key),
            FailureReason::SourceNotRegistered,
        );
        env.storage().instance().remove(&key);

        let list = get_source_list(&env);
        let mut new_list = Vec::<Address>::new(&env);
        for addr in list.iter() {
            if addr != source {
                new_list.push_back(addr);
            }
        }
        env.storage().instance().set(&DataKey::SourceList, &new_list);

        env.events().publish(
            (symbol_short!("oragg"), symbol_short!("src_rm")),
            EvtSrcRm {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                source,
            },
        );
    }

    /// Permissionless: recompute the aggregate from live source reads.
    /// Anyone may call this (it is a pure keeper/refresh action — it cannot
    /// move funds or change governance state), but the result is only ever
    /// derived from governance-registered sources under the governance-set
    /// quorum/deviation policy.
    pub fn aggregate(env: Env) -> AggregateResult {
        let config = load_config(&env);
        let sources = get_source_list(&env);

        let result = compute_aggregate(&env, &config, &sources);

        env.storage().instance().set(&DataKey::LastAggregate, &result);

        env.events().publish(
            (symbol_short!("oragg"), symbol_short!("aggreg")),
            EvtAggreg {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                price: result.price,
                sources_used: result.sources_used,
                total_weight_bps: result.total_weight_bps,
                sources_rejected_deviant: result.sources_rejected_deviant,
            },
        );

        result
    }

    /// Read-only: return the last successfully computed aggregate, but only
    /// if it is still within the staleness bound. This is the "safe
    /// degraded behavior" path for consumers that want a cheap read without
    /// re-querying every source: they get either a trustworthy cached price
    /// or an explicit failure, never a silently-stale one.
    pub fn get_latest(env: Env) -> AggregateResult {
        let config = load_config(&env);
        let last: AggregateResult = unwrap_or_fail(
            &env,
            env.storage().instance().get(&DataKey::LastAggregate),
            FailureReason::NotFound,
        );

        let current_time = env.ledger().timestamp();
        require(
            &env,
            current_time <= last.timestamp + config.max_staleness_seconds,
            FailureReason::OracleDataStale,
        );

        last
    }

    pub fn get_config(env: Env) -> AggregateConfig {
        load_config(&env)
    }

    pub fn get_source(env: Env, source: Address) -> SourceInfo {
        unwrap_or_fail(
            &env,
            env.storage().instance().get(&DataKey::Source(source)),
            FailureReason::SourceNotRegistered,
        )
    }

    pub fn list_sources(env: Env) -> Vec<SourceInfo> {
        let list = get_source_list(&env);
        let mut out = Vec::new(&env);
        for addr in list.iter() {
            let info: SourceInfo = unwrap_or_fail(
                &env,
                env.storage().instance().get(&DataKey::Source(addr)),
                FailureReason::SourceNotRegistered,
            );
            out.push_back(info);
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn load_config(env: &Env) -> AggregateConfig {
    unwrap_or_fail(
        env,
        env.storage().instance().get(&DataKey::Config),
        FailureReason::NotInitialized,
    )
}

fn get_source_list(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::SourceList)
        .unwrap_or_else(|| Vec::new(env))
}

fn validate_config(env: &Env, config: &AggregateConfig) {
    require(env, config.min_quorum_sources >= 1, FailureReason::InvalidQuorumConfig);
    require(
        env,
        config.min_quorum_weight_bps >= 1 && config.min_quorum_weight_bps <= BPS_DENOMINATOR,
        FailureReason::InvalidQuorumConfig,
    );
    require(env, config.max_staleness_seconds > 0, FailureReason::InvalidQuorumConfig);
    require(env, config.max_deviation_bps > 0, FailureReason::InvalidQuorumConfig);
    require(env, config.output_decimals <= 18, FailureReason::InvalidQuorumConfig);
}

/// Normalizes `price` (reported in `from_decimals`) into `to_decimals`,
/// using checked arithmetic throughout so a misconfigured or extreme
/// decimals difference fails loudly (`ArithmeticError`) instead of silently
/// overflowing or wrapping. Reducing decimals truncates toward zero, a
/// bounded, deterministic rounding of strictly less than one unit of the
/// target decimals — the same convention used elsewhere in this codebase
/// (see `liquidity_vault::normalize_price`), just overflow-checked.
fn normalize_checked(env: &Env, price: i128, from_decimals: u32, to_decimals: u32) -> i128 {
    if from_decimals == to_decimals {
        return price;
    }
    if from_decimals < to_decimals {
        let diff = to_decimals - from_decimals;
        let factor = checked_pow10(env, diff);
        price
            .checked_mul(factor)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
    } else {
        let diff = from_decimals - to_decimals;
        let factor = checked_pow10(env, diff);
        price
            .checked_div(factor)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
    }
}

fn checked_pow10(env: &Env, exp: u32) -> i128 {
    10i128
        .checked_pow(exp)
        .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
}

/// |a - b| / b, in basis points, using checked arithmetic. `b` (the
/// reference/median price) is guaranteed > 0 by the caller (median of a set
/// of strictly-positive prices is itself strictly positive).
fn deviation_bps(env: &Env, a: i128, b: i128) -> i128 {
    let diff = if a > b { a - b } else { b - a };
    diff.checked_mul(BPS_DENOMINATOR as i128)
        .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
        .checked_div(b)
        .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
}

/// O(n^2) selection sort by ascending price, bounded by `MAX_SOURCES`
/// (governance-enforced at `add_source` time) so this stays cheap and the
/// `u64` "used" bitmask is always well-defined.
fn sort_by_price(env: &Env, readings: &Vec<WeightedReading>) -> Vec<WeightedReading> {
    let n = readings.len();
    let mut used_mask: u64 = 0;
    let mut sorted = Vec::new(env);
    for _ in 0..n {
        let mut min_idx: u32 = 0;
        let mut min_val: i128 = 0;
        let mut found = false;
        for i in 0..n {
            if used_mask & (1u64 << i) != 0 {
                continue;
            }
            let candidate = unwrap_or_fail(env, readings.get(i), FailureReason::StorageValueMissing);
            if !found || candidate.price < min_val {
                min_val = candidate.price;
                min_idx = i;
                found = true;
            }
        }
        used_mask |= 1u64 << min_idx;
        sorted.push_back(unwrap_or_fail(env, readings.get(min_idx), FailureReason::StorageValueMissing));
    }
    sorted
}

fn sum_weight(readings: &Vec<WeightedReading>) -> u32 {
    let mut total: u32 = 0;
    for r in readings.iter() {
        total += r.weight_bps;
    }
    total
}

/// Lower weighted median: the smallest price at which cumulative weight
/// (walking sorted-ascending) reaches at least half the total weight.
/// Caller guarantees `readings` is non-empty with positive total weight.
fn weighted_median(env: &Env, readings: &Vec<WeightedReading>) -> i128 {
    let sorted = sort_by_price(env, readings);
    let total_weight = sum_weight(&sorted) as u64;

    let mut cumulative: u64 = 0;
    let mut median_price: i128 = unwrap_or_fail(env, sorted.get(0), FailureReason::StorageValueMissing).price;
    for r in sorted.iter() {
        cumulative += r.weight_bps as u64;
        if cumulative * 2 >= total_weight {
            median_price = r.price;
            break;
        }
    }
    median_price
}

/// The core aggregation algorithm. See the module doc comment for the
/// two-pass quorum/median/deviation rationale.
fn compute_aggregate(env: &Env, config: &AggregateConfig, sources: &Vec<SourceInfo>) -> AggregateResult {
    let current_time = env.ledger().timestamp();

    let mut fresh: Vec<WeightedReading> = Vec::new(env);
    let mut sources_considered: u32 = 0;
    let mut rejected_unavailable: u32 = 0;
    let mut rejected_stale: u32 = 0;
    let mut rejected_invalid: u32 = 0;

    for source_addr in sources.iter() {
        let info: SourceInfo = unwrap_or_fail(
            env,
            env.storage().instance().get(&DataKey::Source(source_addr.clone())),
            FailureReason::SourceNotRegistered,
        );
        if !info.enabled {
            continue;
        }
        sources_considered += 1;

        // Fault-tolerant cross-contract call: a source that panics, is
        // unreachable, or returns a malformed value is excluded rather than
        // aborting the whole aggregation (a single hostile/broken source
        // must not be able to DoS price discovery for everyone else).
        let client = OracleSourceClient::new(env, &source_addr);
        let reading = match client.try_get_price() {
            Ok(Ok(r)) => r,
            _ => {
                rejected_unavailable += 1;
                continue;
            }
        };

        if reading.price <= 0 {
            rejected_invalid += 1;
            continue;
        }

        if current_time > reading.timestamp + config.max_staleness_seconds {
            rejected_stale += 1;
            continue;
        }

        let normalized = normalize_checked(env, reading.price, reading.decimals, config.output_decimals);
        if normalized <= 0 {
            rejected_invalid += 1;
            continue;
        }

        fresh.push_back(WeightedReading {
            price: normalized,
            weight_bps: info.weight_bps,
        });
    }

    let fresh_count = fresh.len();
    let fresh_weight = sum_weight(&fresh);

    require(env, fresh_count >= config.min_quorum_sources, FailureReason::InsufficientQuorum);
    require(
        env,
        fresh_weight >= config.min_quorum_weight_bps,
        FailureReason::InsufficientQuorumWeight,
    );

    // Pass 1: preliminary median over all fresh, in-quorum readings. A
    // median already tolerates just under half the *weight* being
    // Byzantine, so this is itself a meaningful anchor even before the
    // explicit deviation filter below.
    let prelim_median = weighted_median(env, &fresh);

    // Pass 2: bounded disagreement — drop any source too far from the
    // preliminary median, then re-check quorum on the survivors.
    let mut in_band: Vec<WeightedReading> = Vec::new(env);
    let mut rejected_deviant: u32 = 0;
    for r in fresh.iter() {
        if deviation_bps(env, r.price, prelim_median) <= config.max_deviation_bps {
            in_band.push_back(r.clone());
        } else {
            rejected_deviant += 1;
        }
    }

    let in_band_count = in_band.len();
    let in_band_weight = sum_weight(&in_band);

    if in_band_count == 0 {
        fail(env, FailureReason::NoValidSources);
    }
    require(
        env,
        in_band_count >= config.min_quorum_sources,
        FailureReason::ExcessiveSourceDisagreement,
    );
    require(
        env,
        in_band_weight >= config.min_quorum_weight_bps,
        FailureReason::ExcessiveSourceDisagreement,
    );

    let final_price = weighted_median(env, &in_band);

    AggregateResult {
        price: final_price,
        decimals: config.output_decimals,
        timestamp: current_time,
        sources_considered,
        sources_used: in_band_count,
        total_weight_bps: in_band_weight,
        sources_rejected_unavailable: rejected_unavailable,
        sources_rejected_stale: rejected_stale,
        sources_rejected_invalid: rejected_invalid,
        sources_rejected_deviant: rejected_deviant,
    }
}

mod test;
mod test_property;
