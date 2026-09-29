# Relayer Slashing Contract

Slashing mechanism for misbehaving relayers in the Chen Pilot cross-chain protocol.

## Overview

Relayers submit Bitcoin SPV proofs to `btc_relay` to mint wrapped BTC on Stellar. The `relayer_slashing` contract deters misbehavior by bonding stake that can be forfeited to the protocol treasury.

## Lifecycle

```
register_relayer → [Active]
     │
     ├── request_unstake → [UnstakeRequested] → (wait unbonding_period) → withdraw_stake → [Withdrawn]
     │
     └── dispute_relayer (admin) → [InDispute]
          │
          └── slash_relayer (admin) → [Slashed]  ← final — no appeal
```

## Slashing Conditions

Slashing is **admin-gated**, not automated. The admin must call two functions in sequence:

1. `dispute_relayer(relayer)` — flags the relayer as `InDispute` and increments `dispute_count`
2. `slash_relayer(relayer)` — executes the penalty

**Slash amount** = `stake_amount × slashing_bps / 10_000`

The slashed amount is transferred to the configured `treasury` address. The relayer's remaining stake stays locked in the contract (cannot be withdrawn by a slashed relayer).

Examples (`slashing_bps = 5000` = 50%):

| Staked | Slashed | Remaining |
|--------|---------|-----------|
| 1000   | 500     | 500       |
| 10000  | 5000    | 5000       |

## Evidence Requirements

There are **no on-chain evidence requirements**. The `slash_relayer` function is authorized solely by `config.admin.require_auth()` — no Merkle proof, signature, or violation record needs to be submitted. Evidence collection and verification are expected to happen **off-chain** before the admin calls the function.

If replayed violations are a concern, the `dispute_count` field tracks how many times a relayer has been disputed and can be used for escalation logic (e.g., harsher penalties on repeated offenses).

## Dispute Process

The dispute process is a **two-phase flow**:

| Phase | Function | Status | Description |
|-------|----------|--------|-------------|
| 1. Dispute | `dispute_relayer` | `InDispute` | Admin flags the relayer, incrementing `dispute_count` |
| 2. Slash (or release) | `slash_relayer` | `Slashed` or stays `InDispute` | Admin executes penalty |

There is **no appeal or review window** built into the contract. The contract does not distinguish between a disputed relayer and one ready to be slashed — the dispute is purely a state flag. There is no function to clear a dispute or return a relayer from `InDispute` to `Active`.

> **Design note:** The dispute phase exists as a warning flag, but the contract provides no on-chain mechanism for a relayer to contest a dispute. Dispute resolution is expected to operate via off-chain governance.

## Slashing Finality

**Slashing is final.** Once `slash_relayer` succeeds, the relayer status is set to `Slashed` and cannot be reverted. The `withdraw_stake` function explicitly rejects slashed relayers (`panic!("slashed relayers cannot withdraw")`). Calling `slash_relayer` on an already-slashed relayer is a no-op.

## Unbonding & Withdrawal

Relayers who have **not** been slashed can exit gracefully:

1. `request_unstake()` — sets status to `UnstakeRequested`, records timestamp
2. After `unbonding_period` seconds, call `withdraw_stake()` — full remaining stake returned to relayer, status set to `Withdrawn`

The unbonding period is set at initialization (`Config.unbonding_period`) and measured in seconds.

## Configuration

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Authorized to dispute and slash relayers |
| `staking_token` | `Address` | Token contract used for bonding |
| `treasury` | `Address` | Receives slashed funds |
| `slashing_bps` | `u32` | Slash penalty in basis points (e.g., 5000 = 50%) |
| `unbonding_period` | `u64` | Seconds a relayer must wait after unstake request |

## Integration Notes

- **Relayers are not registered by the `btc_relay` contract** — there is no on-chain link between `btc_relay` and `relayer_slashing`. A relayer's identity is the Stellar address they use to stake, and misbehavior is detected and adjudicated off-chain.
- The contract can be reused across multiple relayer sets by deploying separate instances with different configs.
- For production use, consider layering additional safeguards off-chain (multi-sig admin, timelock on `slash_relayer`, dispute-review dashboard).
