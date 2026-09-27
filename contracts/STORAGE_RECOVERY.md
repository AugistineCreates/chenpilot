# Storage rent, TTL budget and expiry recovery

The source of truth is `contracts/storage_budget.json`. It is checked against the
storage schemas by `scripts/check-storage-budget.ts`, which runs in
`.github/workflows/contract-storage-budget.yml`. This document explains the rules
and what happens to each kind of state when its TTL runs out.

## What the budget enforces

- Every declared `DataKey` has an entry: owner (contract and writer functions),
  storage tier, class, size bound, renewal policy and expiry behaviour.
- Persistent keys must have a renewal policy. A contract that uses instance
  storage must declare an instance renewal policy.
- `extend_to` may not exceed `network.max_ttl_ledgers` (3,110,400 ledgers, about
  180 days at roughly 17,280 ledgers per day). This is a network parameter that
  can change; confirm it against the current network settings.
- Persistent keys use `restore` on expiry. `recreate` is rejected, because an
  archived persistent entry cannot be re-created. Temporary keys cannot use
  `restore`.
- Per-account, per-item and list data must not live in instance storage unless a
  `waiver` explains why. Instance storage is capped at 64 KB and is loaded on
  every call.
- The number of keys per tier cannot grow without editing the manifest.
- Size bounds are declared design limits, not measurements.

Known gaps carry a `waiver` and are listed in the checker report under `waived`.
They are not fixed here: moving keys between tiers needs a storage migration.

## Recovery by storage class

### Instance storage (contract-wide TTL)

- **On expiry:** the contract instance is archived and the contract cannot be
  invoked, whatever the TTL of its other entries.
- **Prevention:** call `Store::bump_instance` at the start of every public entry
  point, using the contract's `instance_renewal` from the manifest.
- **Recovery:** restore the archived instance (and any archived entries the call
  needs) before invoking the contract. Any account can submit a restore and pays
  the rent. Newer protocol versions can restore automatically during simulation;
  check the current Stellar documentation for the network in use.
- **Tested by:** `contract_instance_is_archived_when_never_bumped`.

### Persistent storage (per-entry TTL)

- **On expiry:** the entry is archived, not deleted. It cannot be read or
  re-created until it is restored.
- **Prevention:** renew on every read and write through `Store`, using the key's
  `renewal` policy (renew when under `threshold` ledgers remain, extend to
  `extend_to`).
- **Recovery:** restore the entry, then use it as normal. Contracts must never
  treat a missing persistent entry as "does not exist" without checking that it
  was not archived.
- **Tested by:** `expired_persistent_entry_cannot_be_read_without_restore`,
  `read_below_threshold_renews_ttl`, `read_above_threshold_leaves_ttl_alone`,
  `persistent_write_sets_ttl_to_policy_extend_to`.

### Temporary storage

- **On expiry:** the entry is deleted permanently and behaves as if it never
  existed.
- **Rule:** only use it for data the contract can recompute or safely lose. Replay
  guards, nonces, balances and anything that must survive belong in persistent
  storage. No key is temporary today.
- **Recovery:** none. The contract must be correct when the entry is missing.
- **Tested by:** `expired_temporary_entry_behaves_as_deleted`.

## Changing the budget

Add or change a key in a contract and the checker fails until
`contracts/storage_budget.json` is updated. Regenerate the schemas with
`scripts/extract-storage-schema.ts`, then run:

    node_modules/.bin/ts-node scripts/check-storage-budget.ts \
      --schemas contracts/schemas --budget contracts/storage_budget.json

## Not covered yet

- The restore transaction itself is not simulated in unit tests; the tests show
  when state becomes unreachable, not the restore call.
- No contract uses `storage_policy` yet (`"adopted": false` in the manifest), so
  the checker cannot verify that code renews entries the way the manifest says.
- Some contracts do not compile on this base, so declared bounds could not be
  measured.
