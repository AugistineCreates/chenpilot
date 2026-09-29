# Bitcoin Relay Finality and Reorganization Policy

> **Update:** this document originally described `btc_relay` before it
> tracked any header-chain state (see #541). `btc_relay` now has an
> **opt-in** header-chain / checkpoint / reorg-detection layer
> (`submit_header`, `get_checkpoint`, `get_header`, `is_block_orphaned` —
> see #576). The sections below are updated to describe both the original,
> still-supported Merkle-proof-only path and the new header-chain path.

## Confirmation policy

### Merkle-proof-depth path (always enforced)

`btc_relay` uses the `Config.min_confirmations` value supplied during
initialization (and subsequently managed through `update_config`) as the
minimum confirmation depth for an SPV proof. The default configured by the
contract test setup is `1`; deployments intended for cross-chain swaps
should configure the operational policy required by their risk model. The
commonly expected Bitcoin policy is **6 confirmations**, but the contract
does not hard-code six confirmations.

A proof is accepted only when its Merkle-proof depth satisfies the
configured minimum. A proof below that depth is rejected before the claim
is recorded. The relay also validates the block-header length,
proof-derived Merkle root, proof-of-work target, and replay status of the
transaction ID.

This check runs on every `verify_and_claim` call, unconditionally, whether
or not the header-chain feature (below) is in use. As already noted before
this update: Merkle-proof depth is a property of *one transaction's
position inside one block* — it is not, by itself, a guarantee about how
many blocks have been mined on top of that block. A caller relying only on
this path has no on-chain guarantee that the referenced block is still on
the canonical chain, or how many real confirmations it has.

`btc_relay_crypto` contains stateless cryptographic helpers only. It does
not maintain Bitcoin chain state or confirmation history.

### Header-chain path (opt-in, added in #576)

A relayer can additionally call `submit_header(header, height)` to register
Bitcoin block headers with the contract, starting from a genesis checkpoint
set once via `set_genesis_checkpoint`. This builds a small, explicit chain
of `HeaderRecord`s linked by `prev_block_hash`, with a `Checkpoint` tracking
the current canonical tip.

When a proof submitted to `verify_and_claim` references a block that **has**
been submitted via `submit_header`, the contract additionally enforces:

- The block must still be marked canonical (not orphaned by a later reorg
  — see below).
- Its *real* confirmation depth (`checkpoint.height - block.height + 1`)
  must also meet `min_confirmations` — independent of, and in addition to,
  the Merkle-proof-depth check above.
- It must not be **stale**: an unclaimed tracked block more than
  `max_stale_depth` blocks (default 144, admin-configurable via
  `set_max_stale_depth`) behind the tip is rejected, since a proof sitting
  unclaimed that long should be re-verified against current chain state
  rather than trusted as-is.

A block never registered via `submit_header` skips these additional checks
entirely and falls back to exactly the Merkle-proof-only behavior described
above — this is deliberate: adopting the header-chain feature is optional,
so existing integrations that only ever called `verify_and_claim` keep
their existing behavior unchanged.

## Reorganization handling

### Before #576

The relay did not maintain a Bitcoin header chain, block heights, parent
links, competing tips, or a finalized-header checkpoint at all. Confirmation
depth was purely a Merkle-proof-depth admission check.

### As of #576

`submit_header` maintains an explicit, height-based canonical-chain
checkpoint (see "Header-chain path" above — this is a height-based
"longest chain" heuristic, not full Bitcoin cumulative-work chain
selection; see the design note in `btc_relay/src/lib.rs` above
`submit_header` for why). When a newly submitted header's height exceeds
the current checkpoint and its ancestry diverges from the currently
canonical chain, that is treated as an explicit reorg:

- Every header on the old, now-displaced branch (from the fork point to
  the previous tip) is marked non-canonical (`HeaderRecord.on_canonical_chain
  = false`) — kept, not deleted, so it remains available for audit.
- Every header on the new branch back to the fork point is marked
  canonical.
- An `EvtReorgApplied` event is published.
- The checkpoint moves to the new tip.

This only happens when the fork point is within `max_safe_reorg_depth`
(default 6, admin-configurable via `set_max_safe_reorg_depth`) of the
previous tip. A reorg whose fork point is **deeper** than that is rejected:
the call panics with `RelayError::ReorgBeyondSafetyDepth` and — because
Soroban invocations are atomic — nothing persists from that call, not even
the `EvtReorgRejected` event that's published immediately before the panic.
A caller/indexer observes this only as the transaction failing.

### What still does *not* happen: retroactive claim reversal

After a proof is accepted via `verify_and_claim`, the transaction ID is
recorded as claimed, and that record is replay-protected with no entry
point that removes it. **This has not changed.** If the block a claim was
based on is later orphaned by an accepted reorg:

1. The already-completed claim is **not** reverted, and the corresponding
   wrapped-asset mint/release is **not** clawed back. `is_claimed(tx_id)`
   continues to return `true`.
2. Any *further* claim attempt whose proof references that now-orphaned
   block **is** rejected, with `RelayError::ProofReferencesOrphanedBlock`
   — this is new in #576, and is the concrete mechanism for "a downstream
   consumer's proof reference becomes stale" that #576 was scoped to
   deliver.
3. Reverting an *already-completed* claim is explicitly out of scope for
   #576: it would mean clawing back funds already released to a recipient
   (and potentially already moved on again downstream), which needs its
   own explicit design — who is authorized to trigger it, how a recipient
   who already spent the released asset is made whole, what the dispute
   window is, etc. That is a materially different, larger problem than
   detecting and blocking *further* reliance on an orphaned block.
4. Any halt, alert, fund-clawback, or compensating action for an
   already-completed claim must still be implemented by the off-chain
   relayer/operations layer or an independently governed emergency
   control — same as before #576. `btc_relay`'s own `pause()` (see
   `pause_state`, #577) can be used operationally to stop *new* claims
   while an incident is investigated, but does not touch existing claims
   either.

### Test coverage

- `test_shallow_reorg_is_applied_and_orphans_the_old_branch` — a 2-block
  reorg within the default safety depth is applied; the displaced branch's
  headers become non-canonical.
- `test_reorg_orphans_original_claim_block_and_blocks_further_claims_on_it` —
  a claim made against a block that a later reorg orphans stays claimed
  (point 1 above), but a further claim attempt against that same block is
  rejected (point 2 above).
- `test_verify_and_claim_rejects_unclaimed_tx_on_orphaned_block` — isolates
  the orphaned-block rejection from replay protection, using a tx that was
  never claimed in the first place.
- `test_reorg_beyond_safety_depth_is_rejected` /
  `test_reorg_beyond_safety_depth_leaves_checkpoint_unchanged` — a reorg
  whose fork point exceeds `max_safe_reorg_depth` is rejected and the
  checkpoint is provably left untouched.
- `test_stale_proof_is_rejected` — an unclaimed tracked block that falls
  more than `max_stale_depth` behind the tip is rejected.
- `test_claims_without_header_chain_are_independent_merkle_proofs_only` —
  documents the still-current fallback behavior for callers that never use
  `submit_header`: two valid, distinct-transaction-ID proofs are both
  accepted independently, exactly as before #576, since the header-chain
  feature is opt-in.

This remains an explicit trust and operational assumption for cross-chain
swaps: the header-chain feature raises the bar (real confirmation depth,
explicit reorg detection, staleness rejection) for integrations that adopt
it, but does not provide cryptographic finality, and does not retroactively
protect a claim that already completed before a reorg was detected.
