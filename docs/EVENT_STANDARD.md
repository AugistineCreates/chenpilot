# Cross-Contract Event Standard

## Scope
All Soroban (Rust) and EVM (Solidity) contracts in this repository.

## Goals
1. Every state-changing function emits at least one event.
2. Events carry a version number so payloads can evolve without breaking parsers.
3. Topic conventions are uniform so a single indexer can filter across contracts.
4. Payloads contain enough context to reconstruct contract state from the event stream alone.

## 1. Versioning
- **Soroban**: Every event data struct contains `version: u32` as the first field.
- **EVM**: Every event has `uint256 indexed version` as the first parameter.

## 2. Topic Conventions

### EVM (Solidity)
- Event names use `PascalCase`.
- Indexed parameters are prefixed in this order: `version`, `actor`.
- Additional indexed parameters follow (`user`, `token`, etc.).

### Soroban (Rust)
- Topics are a fixed 2-tuple: `(symbol_short!("<abbrev>"), symbol_short!("<action>"))`.
- The first topic is the contract abbreviation. The second is the action.

| Contract | Abbreviation |
|----------|-------------|
| `core_vault` | `vault` |
| `liquidity_vault` | `liqv` |
| `rbac` | `rbac` |
| `strategy_registry` | `strat` |
| `relayer_slashing` | `relayer` |
| `por_validator` | `por` |
| `multi_hop_swap` | `swap` |
| `fee_distribution` | `fees` |
| `btc_relay` | `btc` |
| `htlc` | `htlc` |
| `flash_loan_guard` | `flg` |
| `lending_liquidation` | `lend` |
| `intent_market_validator` | `intent` |
| `EmergencyControl` / `CoreEngine` (EVM adapter) | `evm` |

## 3. Data Payload Conventions

Every structured event data struct or event parameter set MUST include:

| Field | Type (Soroban) | Type (EVM) | Notes |
|-------|---------------|------------|-------|
| `version` | `u32` | `uint256` | Schema version for forward/backward compat |
| `ledger` / `block_number` | `u32` | `uint256` | Consensus unit sequence number |
| `actor` | `Address` | `address` | Caller who triggered the state change |

Action-specific fields follow the three required fields.

## 4. State-Reconstruction Rule
A backend replayer MUST be able to replay events in order and reconstruct the full contract state without querying on-chain storage. Events are the source of truth.

## 5. Error / Alert Events
Failure paths that emit events before reverting MUST use the same topic/data standard:
- `("liqv", "dev_alert")`, `("flg", "stale_prc")`, `("intent", "dev_alert")`, etc.
- These are emitted immediately prior to `panic!` / `revert` so they should be treated as "soft halts" with diagnostic payloads.

## 6. Mapping Reference

| Contract | Function | Topic | Data Fields |
|----------|----------|-------|-------------|
| `core_vault` | `init` | `("vault", "init")` | `version`, `ledger`, `actor`, `admin` |
| `core_vault` | `set_backend_status` | `("vault", "backend_status")` | `version`, `ledger`, `actor`, `online` |
| `core_vault` | `deposit` | `("vault", "deposit")` | `version`, `ledger`, `actor`, `user`, `amount` |
| `core_vault` | `force_exit_request` | `("vault", "force_exit_req")` | `version`, `ledger`, `actor`, `user`, `amount`, `eligible_at` |
| `core_vault` | `force_exit_complete` | `("vault", "force_exit_done")` | `version`, `ledger`, `actor`, `user`, `amount` |
| `core_vault` | `propose_upgrade` | `("vault", "upg_prop")` | `version`, `ledger`, `actor`, `new_wasm_hash`, `unlock_ledger` |
| `core_vault` | `cancel_upgrade` | `("vault", "upg_cncl")` | `version`, `ledger`, `actor` |
| `core_vault` | `apply_upgrade` | `("vault", "upg_done")` | `version`, `ledger`, `actor`, `new_wasm_hash` |
| `core_vault` | `transfer_admin` | `("vault", "adm_xfer")` | `version`, `ledger`, `actor`, `old_admin`, `new_admin` |
| `liquidity_vault` | `initialize` | `("liqv", "init")` | `version`, `ledger`, `actor`, `admin`, `oracle`, `threshold_bps` |
| `liquidity_vault` | `update_config` | `("liqv", "cfg_upd")` | `version`, `ledger`, `actor`, `admin`, `oracle`, `threshold_bps` |
| `liquidity_vault` | `execute_protected_swap` (ok) | `("liqv", "swap_ok")` | `version`, `ledger`, `actor`, `token_in`, `token_out`, `amount_in`, `market_price` |
| `liquidity_vault` | `execute_protected_swap` (alert) | `("liqv", "dev_alert")` | `version`, `ledger`, `actor`, `market_price`, `intent_price`, `deviation_bps` |
| `rbac` | `init` | `("rbac", "init")` | `version`, `ledger`, `actor`, `super_admin` |
| `rbac` | `grant_role` | `("rbac", "role_grant")` | `version`, `ledger`, `actor`, `to`, `role`, `by` |
| `rbac` | `revoke_role` | `("rbac", "role_revoke")` | `version`, `ledger`, `actor`, `from`, `role`, `by` |
| `rbac` | `transfer_admin` | `("rbac", "adm_xfer")` | `version`, `ledger`, `actor`, `old_admin`, `new_admin` |
| `strategy_registry` | `init` | `("strat", "init")` | `version`, `ledger`, `actor`, `admin` |
| `strategy_registry` | `set_ai_agent` | `("strat", "agent_set")` | `version`, `ledger`, `actor`, `ai_agent`, `authorized` |
| `strategy_registry` | `add_verified_pool` | `("strat", "pool_add")` | `version`, `ledger`, `actor`, `pool_id` |
| `strategy_registry` | `remove_verified_pool` | `("strat", "pool_rm")` | `version`, `ledger`, `actor`, `pool_id` |
| `strategy_registry` | `vote_strategy` | `("strat", "vote")` | `version`, `ledger`, `actor`, `ai_agent`, `pool_id`, `total_votes` |
| `relayer_slashing` | `initialize` | `("relayer", "init")` | `version`, `ledger`, `actor`, `admin`, `staking_token`, `treasury`, `slashing_bps`, `unbonding_period` |
| `relayer_slashing` | `register_relayer` | `("relayer", "stake")` | `version`, `ledger`, `actor`, `relayer`, `stake_amount` |
| `relayer_slashing` | `request_unstake` | `("relayer", "unstake")` | `version`, `ledger`, `actor`, `relayer`, `requested_at` |
| `relayer_slashing` | `dispute_relayer` | `("relayer", "dispute")` | `version`, `ledger`, `actor`, `relayer`, `dispute_count` |
| `relayer_slashing` | `slash_relayer` | `("relayer", "slashed")` | `version`, `ledger`, `actor`, `relayer`, `slash_amount`, `new_stake` |
| `relayer_slashing` | `withdraw_stake` | `("relayer", "withdraw")` | `version`, `ledger`, `actor`, `relayer`, `withdrawn_amount` |
| `por_validator` | `initialize` | `("por", "init")` | `version`, `ledger`, `actor`, `admin`, `wbtc_token`, `oracle`, `tolerance_bps` |
| `por_validator` | `update_config` | `("por", "cfg_upd")` | `version`, `ledger`, `actor`, `admin`, `oracle`, `tolerance_bps` |
| `por_validator` | `set_safety_policy` | `("por", "safety_cfg")` | `version`, `ledger`, `actor`, `proof_cadence_ledgers`, `max_stale_ledgers` |
| `por_validator` | `verify_reserves` (ok) | `("por", "proof")` | `version`, `ledger`, `actor`, `is_valid`, `balance`, `circulating_supply`, `verified_ledger`, `valid_until_ledger` |
| `multi_hop_swap` | `swap` (per hop) | `("swap", "hop")` | `version`, `ledger`, `actor`, `pool`, `token_in`, `token_out`, `amount_in`, `amount_out` |
| `multi_hop_swap` | `swap` (final) | `("swap", "done")` | `version`, `ledger`, `actor`, `total_in`, `total_out` |
| `fee_distribution` | `initialize` | `("fees", "init")` | `version`, `ledger`, `actor`, `admin`, `treasury`, `ai_agent_pool`, `lp_pool`, `treasury_bps`, `ai_agent_bps` |
| `fee_distribution` | `update_config` | `("fees", "cfg_upd")` | `version`, `ledger`, `actor`, `admin`, `treasury`, `ai_agent_pool`, `lp_pool`, `treasury_bps`, `ai_agent_bps` |
| `fee_distribution` | `distribute` | `("fees", "split")` | `version`, `ledger`, `actor`, `nonce`, `token`, `from`, `amount`, `treasury_share`, `ai_agent_share`, `lp_share` |
| `fee_distribution` | `stake` | `("fees", "stake")` | `version`, `ledger`, `actor`, `token`, `user`, `amount`, `total_shares` |
| `fee_distribution` | `unstake` | `("fees", "unstake")` | `version`, `ledger`, `actor`, `token`, `user`, `amount`, `total_shares` |
| `fee_distribution` | `claim` | `("fees", "claim")` | `version`, `ledger`, `actor`, `token`, `user`, `amount` |
| `btc_relay` | `initialize` | `("btc", "init")` | `version`, `ledger`, `actor`, `admin`, `wrapped_btc_token`, `min_confirmations`, `crypto_contract` |
| `btc_relay` | `update_config` | `("btc", "cfg_upd")` | `version`, `ledger`, `actor`, `admin`, `wrapped_btc_token`, `min_confirmations`, `crypto_contract` |
| `btc_relay` | `verify_and_claim` | `("btc", "relay_ok")` | `version`, `ledger`, `actor`, `tx_id`, `recipient`, `amount_sat` |
| `htlc` | `init_swap` | `("htlc", "init")` | `version`, `ledger`, `actor`, `swap_id`, `initiator`, `recipient`, `token`, `amount`, `expiry_ledger` |
| `htlc` | `claim` | `("htlc", "claim")` | `version`, `ledger`, `actor`, `swap_id`, `recipient`, `amount` |
| `htlc` | `refund` | `("htlc", "refund")` | `version`, `ledger`, `actor`, `swap_id`, `initiator`, `amount` |
| `flash_loan_guard` | `initialize` | `("flg", "init")` | `version`, `ledger`, `actor`, `admin`, `oracle`, `guarded_asset`, `max_intra_ledger_deviation_bps`, `min_ledger_gap` |
| `flash_loan_guard` | `update_config` | `("flg", "cfg_upd")` | `version`, `ledger`, `actor`, `admin`, `oracle`, `guarded_asset`, `max_intra_ledger_deviation_bps`, `min_ledger_gap` |
| `flash_loan_guard` | `record_snapshot` | `("flg", "snapshot")` | `version`, `ledger`, `actor`, `price`, `oracle_timestamp`, `oracle_sequence` |
| `flash_loan_guard` | `record_snapshot` (stale) | `("flg", "stale_prc")` | `version`, `ledger`, `actor`, `oracle_timestamp`, `current_time`, `max_staleness` |
| `flash_loan_guard` | `record_snapshot` (seq attk) | `("flg", "seq_attk")` | `version`, `ledger`, `actor`, `prev_seq`, `new_seq`, `price_diff` |
| `flash_loan_guard` | `record_snapshot` (stale upd) | `("flg", "stale_upd")` | `version`, `ledger`, `actor`, `prev_timestamp`, `current_time` |
| `flash_loan_guard` | `assert_price_safe` (ok) | `("flg", "price_safe")` | `version`, `ledger`, `actor`, `snap_price`, `current_price`, `deviation_bps` |
| `flash_loan_guard` | `assert_price_safe` (stale chk) | `("flg", "stale_chk")` | `version`, `ledger`, `actor`, `snap_timestamp`, `current_time` |
| `flash_loan_guard` | `assert_price_safe` (tim edge) | `("flg", "tim_edge")` | `version`, `ledger`, `actor`, `snap_ledger`, `current_ledger` |
| `flash_loan_guard` | `assert_price_safe` (block) | `("flg", "flash_blk")` | `version`, `ledger`, `actor`, `snap_price`, `current_price`, `deviation_bps` |
| `lending_liquidation` | `initialize` | `("lend", "init")` | `version`, `ledger`, `actor`, `admin`, `oracle`, `collateral_token`, `debt_token`, `min_health_factor`, `liquidation_bonus_bps`, `ltv_bps` |
| `lending_liquidation` | `update_config` | `("lend", "cfg_upd")` | `version`, `ledger`, `actor`, `admin`, `oracle`, `collateral_token`, `debt_token`, `min_health_factor`, `liquidation_bonus_bps`, `ltv_bps` |
| `lending_liquidation` | `deposit_and_borrow` | `("lend", "deposit")` | `version`, `ledger`, `actor`, `borrower`, `collateral_amount`, `borrow_amount`, `health_factor` |
| `lending_liquidation` | `liquidate` | `("lend", "liquidate")` | `version`, `ledger`, `actor`, `liquidator`, `borrower`, `repay_amount`, `collateral_seized`, `health_factor` |
| `intent_market_validator` | `initialize` | `("intent", "init")` | `version`, `ledger`, `actor`, `threshold_bps` |
| `intent_market_validator` | `update_config` | `("intent", "cfg_upd")` | `version`, `ledger`, `actor`, `threshold_bps` |
| `intent_market_validator` | `validate` (alert) | `("intent", "dev_alert")` | `version`, `ledger`, `actor`, `market_value`, `intent_value`, `deviation_bps` |
| `EmergencyControl` | `pause` | `EmergencyPaused` (EVM) | `uint256 indexed version`, `address indexed actor`, `uint256 timestamp` |
| `EmergencyControl` | `unpause` | `EmergencyUnpaused` (EVM) | `uint256 indexed version`, `address indexed actor`, `uint256 timestamp` |
| `CoreEngine` | `deposit` | `Deposited` | `uint256 indexed version`, `address indexed actor`, `address indexed token`, `uint256 amount`, `uint256 block_timestamp` |
| `CoreEngine` | `swap` | `Swapped` | `uint256 indexed version`, `address indexed actor`, `address indexed fromToken`, `address indexed toToken`, `uint256 amount`, `uint256 block_timestamp` |
| `CoreEngine` | `rebalance` | `Rebalanced` | `uint256 indexed version`, `address indexed actor`, `address[] tokens`, `uint256[] amounts`, `uint256 block_timestamp` |
| `CoreEngine` | `emergencyWithdraw` | `EmergencyWithdrawn` | `uint256 indexed version`, `address indexed actor`, `address indexed user`, `address indexed token`, `uint256 amount` |

## 7. Soroban Code Pattern

```rust
#[contracttype]
#[derive(Clone)]
pub struct Evt<Action> {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    // action-specific fields...
}

// Emit:
let version = 1;
let ledger = env.ledger().sequence();
let actor = /* caller */;
env.events().publish(
    (symbol_short!("abbrev"), symbol_short!("action")),
    EvtAction { version, ledger, actor, /* ... */ },
);
```

## 8. EVM Code Pattern

```solidity
event Action(
    uint256 indexed version,
    address indexed actor,
    // action-specific fields...
);

emit Action(1, msg.sender, /* ... */);
```
