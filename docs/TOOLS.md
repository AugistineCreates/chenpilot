# Agent Tools Documentation

This document is automatically generated. Do not edit manually.

## Table of Contents

- [CONTACTS](#contacts)
  - [contact_tool](#contact-tool)
- [DEFI](#defi)
  - [multi_hop_trade](#multi-hop-trade)
- [GENERAL](#general)
  - [get_xlm_liquidity](#get-xlm-liquidity)
- [META](#meta)
  - [meta_tool](#meta-tool)
- [METADATA](#metadata)
  - [sep1_tool](#sep1-tool)
- [PRICE](#price)
  - [price_tool](#price-tool)
- [QA](#qa)
  - [qa_tool](#qa-tool)
- [SECURITY](#security)
  - [risk_analysis_tool](#risk-analysis-tool)
- [SOROBAN](#soroban)
  - [soroban_contract_state](#soroban-contract-state)
  - [soroban_invoke](#soroban-invoke)
- [STELLAR](#stellar)
  - [get_liquidity_pool_stats](#get-liquidity-pool-stats)
  - [strategy_registry](#strategy-registry)
- [TRADING](#trading)
  - [swap_tool](#swap-tool)
- [WALLET](#wallet)
  - [wallet_tool](#wallet-tool)

---

## CONTACTS

### contact_tool

Manage contacts: create, list, and delete contacts.

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| operation | string | Yes | The contact operation to perform | `create`, `list`, `delete` |
| payload | object | No | Payload for the operation | - |

#### Examples

- save this address 0x123 as my_btc_wallet
- list all my contacts
- remove my_btc_wallet from my contact list

---

## DEFI

### multi_hop_trade

Evaluate and find optimal multi-hop trading paths across Stellar DEX using multiple intermediate assets

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| fromAsset | string | Yes | Source asset symbol (e.g., XLM, USDC, USDT) | `XLM`, `USDC`, `USDT` |
| toAsset | string | Yes | Destination asset symbol (e.g., XLM, USDC, USDT) | `XLM`, `USDC`, `USDT` |
| amount | number | Yes | Amount of source asset to trade | - |

#### Examples

- Find best path to swap 100 XLM to USDC
- Evaluate multi-hop routes from USDC to USDT with max 3 hops
- Compare trading paths for 500 XLM to USDT

---

## GENERAL

### get_xlm_liquidity

Fetch real-time liquidity data for XLM trading pairs using the configured Stellar Horizon network.

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| assetCode | string | Yes |  | - |
| assetIssuer | string | Yes |  | - |
| depthLimit | number | No |  | - |

---

## META

### meta_tool

Provides information about the agent (name, capabilities, version).

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| operation | string | Yes | The meta operation to perform | `get_name`, `get_capabilities`, `get_version`, `get_creator` |

#### Examples

- What is your name?
- What can you do?
- What version are you?

---

## METADATA

### sep1_tool

Retrieve and parse stellar.toml metadata to provide token information (SEP-1)

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| operation | string | Yes | The SEP-1 operation to perform | `get_asset_metadata`, `get_domain_metadata`, `list_assets` |
| asset | string | No | Asset code:issuer (e.g., USDC:GA...Z46) or code only for XLM | - |
| domain | string | No | Domain to fetch stellar.toml from (e.g., example.com) | - |

#### Examples

- Get metadata for USDC asset
- Get stellar.toml from example.com
- List all assets from stellar.org
- What is the metadata for TEST asset from test.com?

---

## PRICE

### price_tool

Get real-time asset prices from Stellar DEX with Redis caching for fast lookups

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| operation | string | Yes | The price operation to perform | `get_price`, `get_prices`, `get_orderbook`, `cache_stats` |
| from | string | No | Source asset symbol | `XLM`, `USDC`, `USDT` |
| to | string | No | Target asset symbol | `XLM`, `USDC`, `USDT` |
| amount | number | No | Amount to get price for (default: 1) | - |
| pairs | array | No | Array of asset pairs for batch price lookup | - |
| limit | number | No | Limit for orderbook depth (default: 20) | - |

#### Examples

- What's the price of XLM in USDC?
- Get price for 100 XLM to USDT
- Show me the orderbook for XLM/USDC
- Get prices for multiple pairs
- Show cache statistics

---

## QA

### qa_tool

Answer user questions about transactions, balances, and contacts.

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| operation | string | Yes | The operation to perform | `ask` |
| payload | object | Yes | Payload containing the user query and optional context | - |

#### Examples

- who did I send STRK to yesterday?
- can you help me transfer money?
- is it safe to perform this transaction?
- what’s my wallet balance?

---

## SECURITY

### risk_analysis_tool

Analyze sandwich attack and flash swap risks for DEX swaps

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| from | string | Yes | Source token symbol | `XLM`, `USDC`, `USDT` |
| to | string | Yes | Target token symbol | `XLM`, `USDC`, `USDT` |
| amount | number | Yes | Amount to analyze | - |

#### Examples

- Analyze risk for swapping 1000 XLM to USDC
- Check sandwich attack risk for 500 USDC to XLM

---

## SOROBAN

### soroban_contract_state

Query the state of a Soroban smart contract for DeFi decision making. Supports querying reserves, balances, rates, and other contract state.

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| network | string | No | Soroban network to query | `testnet`, `mainnet` |
| rpcUrl | string | No | Override Soroban RPC URL | - |
| contractId | string | Yes | Soroban contract ID (starts with C...) | - |
| stateKeys | array | No | Specific state keys to query (e.g., [ | - |
| methods | array | No | Contract methods to call for state (e.g., [ | - |
| includeMetadata | boolean | No | Include contract metadata (admin, version, etc.) | - |

#### Examples

- Query reserves and fee from liquidity pool contract CABC...
- Get total supply and borrow rate from lending contract CXYZ... on mainnet
- Check staking balance and pending rewards for contract CDEF...
- Query all token information (name, symbol, decimals, total supply) from CTOKEN...

---

### soroban_invoke

Invoke Soroban smart contracts (read-only simulation)

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| network | string | No | Soroban network to use | `testnet`, `mainnet` |
| rpcUrl | string | No | Override Soroban RPC URL | - |
| contractId | string | Yes | Soroban contract ID (starts with C...) | - |
| method | string | Yes | Contract function name to call | - |
| args | array | No | Arguments for the contract method | - |
| source | object | No | Optional source account info | - |
| fee | number | No | Optional fee override | - |
| timeoutMs | number | No | Optional timeout override in milliseconds | - |

---

## STELLAR

### get_liquidity_pool_stats

Fetch statistics for a Stellar AMM liquidity pool by pool ID, including reserves, volume, and estimated APR

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| poolId | string | Yes | 64-character hexadecimal Stellar AMM liquidity pool ID | - |

#### Examples

- Get stats for liquidity pool abc123...
- Show me the APR for this pool
- What are the reserves in pool 0x...

---

### strategy_registry

Interact with the Yield-Aggregator Strategy Registry to vote on Stellar DEX pools or check verification status.

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| action | string | Yes | Action to perform:  | - |
| poolId | string | No | 64-character hexadecimal Stellar AMM liquidity pool ID | - |
| aiAgent | string | No | The public key of the AI agent casting the vote (required for  | - |

#### Examples

- Vote for pool abc123...
- What is the current yield strategy?
- Is this pool verified by the registry?

---

## TRADING

### swap_tool

Swap tokens on the Stellar DEX using path payments

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| from | string | Yes | Source token symbol | `XLM`, `USDC`, `USDT` |
| to | string | Yes | Target token symbol | `XLM`, `USDC`, `USDT` |
| amount | number | Yes | Amount to swap | - |

#### Examples

- Swap 100 XLM to USDC
- Convert 50 USDC to XLM
- Exchange 10 USDT for XLM

---

## WALLET

### wallet_tool

Wallet operations including balance checking, transfers, and address retrieval

**Version:** 1.0.0

#### Parameters

| Parameter | Type | Required | Description | Options |
| --- | --- | --- | --- | --- |
| operation | string | Yes | The wallet operation to perform | `get_balance`, `transfer`, `get_address` |
| token | string | No | Token symbol for balance operations | `STRK`, `ETH`, `DAI` |
| to | string | No | Recipient address for transfers | - |
| amount | number | No | Amount to transfer | - |

#### Examples

- Check my STRK balance
- Transfer 100 STRK to 0x123...
- Get my wallet address

---

