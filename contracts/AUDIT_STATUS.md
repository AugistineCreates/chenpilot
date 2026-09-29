# Contract Audit Status

This document tracks the audit coverage and review status for each contract in the Soroban suite. It maps every contract to its last audit date, auditor, findings severity, and current mitigation status.

## Status Legend

| Status | Meaning |
|--------|---------|
| ✅ **Complete** | Formal external audit passed with no unresolved findings |
| ⚠️ **In Progress** | Audit underway or scheduled with an external firm |
| 🔬 **Prep Done** | Audit-preparation documents exist (threat model, invariants, storage map, auth matrix); no external audit yet |
| ❌ **None** | No audit coverage of any kind |

Risk classifications follow the [CVSS v3.1](https://www.first.org/cvss/v3-1/specification-document) severity rubric.

---

## Audit Status Table

| Contract | Risk Level | Audit Status | Last Audit Date | Auditor | Findings Severity | Mitigation Status |
|----------|-----------|--------------|----------------|---------|-------------------|-------------------|
| `core_vault` | **Critical** – central asset vault for lending/borrowing | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `flash_loan_guard` | **Critical** – price-manipulation protection; common DeFi attack vector | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `lending_liquidation` | **Critical** – liquidation engine; incorrect logic causes bad debt | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `relayer_slashing` | **Critical** – slashing conditions; errors can unfairly punish or fail to punish | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `btc_relay` | **High** – SPV proof verification for cross-chain bridge | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `btc_relay_crypto` | **High** – cryptographic primitives (SHA-256, Merkle, ECDSA) | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `multi_hop_swap` | **High** – atomic multi-hop swap across pools | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `htlc` | **High** – hashed timelock contracts for atomic swaps | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `liquidity_vault` | **High** – liquidity pool management (constant-product AMM) | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `rbac` | **High** – role-based access control for entire protocol | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `fee_distribution` | **Medium** – protocol fee allocation to recipients | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `intent_market_validator` | **Medium** – market intent signature verification | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `por_validator` | **Medium** – proof-of-reserve on-chain verification | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `strategy_registry` | **Medium** – strategy registration and approval | 🔬 Prep Done | — | — | — | Audit-prep docs exist; no external audit performed |
| `access/EmergencyControl.sol` | **Medium** – emergency pause and control functions | ❌ None | — | — | — | No audit-prep documents; no external audit |
| `strategy_boundary/` | **Medium** – strategy execution boundary enforcement | ❌ None | — | — | — | No audit-prep documents; no external audit |
| `unified_auth/` | **Medium** – unified authentication across contracts | ❌ None | — | — | — | No audit-prep documents; no external audit |

> The backend audit (`SECURITY_AUDIT_106.md`, dated 2026-03-24) covers Node.js/TypeScript services only, **not** the Soroban smart contracts. The `contracts/` directory contains comprehensive audit-preparation documents (`AUDIT_README.md`, `THREAT_MODELS.md`, `INVARIANTS.md`, `STORAGE_MAPS.md`, `AUTHORIZATION_MATRICES.md`, `TEST_EVIDENCE.md`) but no Soroban contract has yet undergone an external security audit.

---

## High-Priority Contracts Requiring External Audit

The following contracts are flagged as **high priority for formal external review** due to their risk level and current lack of audit coverage:

### Critical Priority

| Contract | Rationale |
|----------|-----------|
| `core_vault` | Central asset custody; a vulnerability could drain all protocol funds |
| `flash_loan_guard` | Common DeFi attack vector; flash-loan price manipulation has been exploited repeatedly across the industry |
| `lending_liquidation` | Incorrect liquidation logic leads directly to bad debt or unfair liquidations |
| `relayer_slashing` | Slashing errors can unfairly destroy bonded stake or fail to punish misbehavior |

### High Priority

| Contract | Rationale |
|----------|-----------|
| `btc_relay` | Cross-chain bridge security; a compromise could mint unbacked wrapped BTC |
| `btc_relay_crypto` | Cryptographic primitive correctness underpins all bridge operations |
| `multi_hop_swap` | Multi-hop routing; a bug could cause fund loss during inter-pool transfers |
| `htlc` | Atomic swap correctness; errors can lock funds permanently |
| `liquidity_vault` | AMM pool logic; bugs can drain LP reserves |
| `rbac` | Entire protocol's authorization model; a bypass grants universal access |

---

## Audit Preparation Documents

Every contract listed as 🔬 **Prep Done** has the following audit-preparation documents in its directory, written by the development team as part of internal review:

| Document | Contents |
|----------|----------|
| `audit/threat_model.md` | Attack vectors, impact analysis, and implemented mitigations |
| `audit/invariants.md` | Contract-specific safety properties that must always hold |
| `audit/storage.md` | Storage layout, key schemas, and TTL configurations |
| `audit/authorization.md` | Role/permission matrices and access control flows |

These documents are intended to accelerate external audit onboarding. They are **not a substitute** for an independent security review.

---

## Recommendations

1. **Engage an external auditor** for all Critical-risk contracts before mainnet deployment
2. **Create audit-prep documents** for `access/EmergencyControl.sol`, `strategy_boundary/`, and `unified_auth/` to match the standard set by other contracts
3. **Property-based fuzzing**: Expand invariant testing (currently only `flash_loan_guard` and `liquidity_vault` have property tests)
4. **Re-audit after any material code change** that touches security-critical paths
