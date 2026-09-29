# Soroban Contract Suite - Audit Documentation

This directory contains the complete audit package for the Chen Pilot Soroban smart contract suite.

## Document Structure

### Overview
- **AUDIT_README.md** - This file, navigation guide
- **THREAT_MODELS.md** - Comprehensive threat analysis for each contract
- **INVARIANTS.md** - Contract invariants and safety properties
- **STORAGE_MAPS.md** - Detailed storage layout and data structures
- **AUTHORIZATION_MATRICES.md** - Access control and permission matrices
- **TEST_EVIDENCE.md** - Test coverage and evidence summary

### Contract Documentation
Each contract has its own audit subdirectory:
```
contracts/
├── btc_relay/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── rbac/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── multi_hop_swap/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── flash_loan_guard/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── core_vault/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── fee_distribution/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── htlc/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── intent_market_validator/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── lending_liquidation/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── liquidity_vault/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── por_validator/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── relayer_slashing/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
├── strategy_registry/
│   └── audit/
│       ├── threat_model.md
│       ├── invariants.md
│       ├── storage.md
│       └── authorization.md
└── btc_relay_crypto/
    └── audit/
        ├── threat_model.md
        ├── invariants.md
        ├── storage.md
        └── authorization.md
```

## Protocol Overview

The Chen Pilot Soroban contract suite implements a cross-chain DeFi protocol with the following components:

### Core Infrastructure
- **RBAC** - Role-based access control system
- **BTC Relay** - Bitcoin SPV verification for cross-chain bridges
- **BTC Relay Crypto** - Cryptographic primitives for Bitcoin operations

### DeFi Primitives
- **Multi-Hop Swap** - Atomic multi-hop token swaps across pools
- **Flash Loan Guard** - Price manipulation protection for flash loans
- **Core Vault** - Centralized asset vault for lending/borrowing
- **Liquidity Vault** - Liquidity pool management
- **HTLC** - Hashed timelock contracts for atomic swaps

### Validation & Security
- **Intent Market Validator** - Validation of market intent operations
- **Proof of Reserve Validator** - On-chain reserve verification
- **Relayer Slashing** - Slashing conditions for relayer misbehavior

### Economic Mechanisms
- **Fee Distribution** - Protocol fee allocation
- **Lending Liquidation** - Liquidation logic for lending positions
- **Strategy Registry** - Strategy registration and management

## Security Assumptions

### Soroban Environment
- Soroban VM provides deterministic execution
- Gas metering prevents infinite loops
- Storage TTL ensures data expiration
- Cross-contract calls are atomic within a transaction

### Cryptographic Assumptions
- SHA-256 is preimage-resistant
- ECDSA signatures are secure (Stellar's ed25519)
- Merkle tree inclusion proofs are sound
- Bitcoin proof-of-work is economically infeasible to break

### Network Assumptions
- Stellar network provides finality after ~5 seconds
- Horizon API provides accurate account/ledger data
- Oracle price feeds are updated with reasonable frequency
- Admin keys are securely managed by protocol operators

## Audit Scope

### In Scope
- All Soroban contracts in this workspace
- Cross-contract interactions
- Storage layout and TTL management
- Access control mechanisms
- Economic incentive alignment

### Out of Scope
- Off-chain components (backend services, bots)
- External oracle implementations
- Stellar network consensus
- Bitcoin network security
- Key management practices

## Testing Evidence

Test coverage reports are located in each contract's `src/test.rs` file. Additional property-based tests are in:
- `flash_loan_guard/src/test_invariants.rs`
- `flash_loan_guard/src/test_freshness.rs`
- `liquidity_vault/src/test_property.rs`

To run the full test suite:
```bash
cd contracts
cargo test --workspace
```

To generate coverage reports:
```bash
cargo tarpaulin --workspace --out Html
```

## Version Information

- Soroban SDK version: See Cargo.toml
- Rust version: 1.70+
- Last audit preparation date: 2026-07-28

## Contact

For questions about this audit package, contact:
- Protocol: Chen Pilot
- Repository: gear5labs/chenpilot-experimental
