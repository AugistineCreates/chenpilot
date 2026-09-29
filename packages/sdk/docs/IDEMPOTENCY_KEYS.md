# Idempotency Keys

The SDK uses deterministic, operation-scoped idempotency keys for requests that may be retried. A key is derived from the complete request identity and has the following format:

```text
chenpilot:idempotency:v1:<operation>:<encoded-canonical-request>
```

The request object is serialized canonically: object properties are sorted recursively, undefined properties are omitted, and arrays retain their order. Consequently, retries with the same operation and request identity produce the same key. Changing the operation, destination, amount, asset, route, protocol, or position produces a different key.

## Operation coverage

| Operation type | Idempotency key generator | Required identity fields |
| --- | --- | --- |
| BTC → Stellar swap | `createBtcToStellarSwapIdempotencyKey` | Bitcoin transaction ID, Stellar destination, amount |
| Stellar → BTC swap | `createStellarToBtcSwapIdempotencyKey` | Stellar transaction ID, Bitcoin destination, amount |
| Multi-hop swap | `createMultiHopSwapIdempotencyKey` | Source/destination chains and assets, amount, destination, ordered hops |
| Lending deposit | `createLendingDepositIdempotencyKey` | Protocol, user, asset, amount |
| Lending borrow | `createLendingBorrowIdempotencyKey` | Protocol, user, asset, amount |
| Lending repay | `createLendingRepayIdempotencyKey` | Protocol, user, asset, amount, position when applicable |
| Lending withdraw | `createLendingWithdrawIdempotencyKey` | Protocol, user, asset, amount, position when applicable |
| Lending liquidation | `createLendingLiquidationIdempotencyKey` | Protocol, user, asset, position when applicable |
| Generic lending operation | `createLendingOperationIdempotencyKey` | Operation, protocol, user, asset, and operation-specific fields |

There are no missing generators for the SDK swap and lending operation types listed above.

## Usage

```typescript
import {
  createStellarToBtcSwapIdempotencyKey,
  createMultiHopSwapIdempotencyKey,
  createLendingDepositIdempotencyKey,
} from "@chen-pilot/sdk-core";

const swapKey = createStellarToBtcSwapIdempotencyKey({
  stellarTransactionId: "stellar-tx-id",
  bitcoinDestination: "bc1...",
  amount: "100000",
  fromAsset: "USDC",
  toAsset: "BTC",
});

const routeKey = createMultiHopSwapIdempotencyKey({
  sourceChain: "stellar",
  destinationChain: "bitcoin",
  sourceAsset: "USDC",
  destinationAsset: "BTC",
  amount: "100000",
  destinationAddress: "bc1...",
  hops: ["stellar-amm", "btc-bridge"],
});

const lendingKey = createLendingDepositIdempotencyKey({
  protocol: "example-lending",
  userAddress: "G...",
  asset: "USDC",
  amount: "1000000",
});
```

## Retry rules

- Reuse the same key when retrying the same logical request.
- Generate a new key only when the logical request changes.
- Do not use a random UUID for a retry of an existing request.
- Include a stable source transaction ID or position ID whenever one exists.
- Treat the key as an identifier, not as a secret; do not place credentials in request fields.

The `v1` segment is part of the public strategy. A future canonicalization change must use a new version so old and new requests cannot accidentally share keys.
