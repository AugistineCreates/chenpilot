# Encryption key rotation runbook

Ciphertexts written by Chenpilot use an authenticated `cpenc1` envelope. Its
header identifies version `1`, algorithm `aes-256-gcm`, and a key identifier.
The header is authenticated as AES-GCM additional data, so metadata changes
make decryption fail. Legacy ciphertext remains readable through
`ENCRYPTION_KEY` until it has been rotated.

## Normal online rotation

1. Generate a 32-byte key using the approved secrets system. Do not put key
   material in source control or logs.
2. Add both old and new keys to `ENCRYPTION_KEYS_JSON`, for example
   `{"2026-01":"<64 hex>","2026-08":"<64 hex>"}`. Keep
   `ENCRYPTION_KEY` configured while any unversioned (`legacy`) records exist.
3. Set `ENCRYPTION_ACTIVE_KEY_ID=2026-08`, deploy, and verify normal account
   reads and writes. This is dual-read/single-write: all configured,
   non-revoked versions can be read, but new writes use only the active key.
4. Apply database migrations, then rotate in bounded transactions:

   ```sh
   npm run keys:rotate -- rotate 2026-01 2026-08 100
   # Use `legacy` as the source ID for old unversioned ciphertext.
   ```

   It is safe to stop and rerun this command. Each transaction commits account
   updates with its checkpoint, conditional writes avoid clobbering concurrent
   changes, and records already using the target key are skipped.

5. Inspect progress at any time:

   ```sh
   npm run keys:rotate -- status 2026-01 2026-08
   ```

   Application logs emit `Encryption key rotation batch completed/failed`
   with key IDs, counts, status, and no plaintext or key material.
   `getKeyRotationMetrics()` exposes batch success/failure and record counters
   to the in-process metrics integration.

6. Before removing the old key, run:

   ```sh
   npm run keys:rotate -- retire-check 2026-01
   ```

   Retirement is blocked while the key is active or any ciphertext references
   it. Remove it from the keyring only after this command succeeds on every
   environment. Remove `ENCRYPTION_KEY` only after `legacy` also passes.

## Rollback

Keep both versions configured throughout the observation window. To roll back,
set the former key as active and redeploy; records written under either version
remain readable. Run the same command in reverse (`new old`) to converge, then
perform `retire-check` before removing the new key. Never restore a database
checkpoint without restoring the matching ciphertext rows.

## Emergency revocation

Add compromised identifiers to the comma-separated
`ENCRYPTION_REVOKED_KEY_IDS` list and make a different configured key active.
Reads of revoked ciphertext fail closed and the logs identify only the key ID.
Immediate revocation can make affected accounts unavailable; preserve the key
in the secrets system for incident responders and restore from a known-good
backup or controlled offline re-encryption. Do not bypass revocation or copy
plaintext/key material into logs. After recovery, rotate, verify zero
references, retire the compromised key, and retain the checkpoint/log evidence.
