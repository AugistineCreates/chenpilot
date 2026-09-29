#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Bytes, BytesN, Env, Vec};

use btc_relay_crypto::BtcCryptoContract;

fn setup(env: &Env) -> (Address, Address, BtcRelayContractClient) {
    let admin = Address::generate(env);
    let token = Address::generate(env);

    let crypto_id = env.register(BtcCryptoContract, ());
    let contract_id = env.register(BtcRelayContract, ());
    let client = BtcRelayContractClient::new(env, &contract_id);
    client.initialize(&admin, &token, &1, &crypto_id);
    (admin, token, client)
}

fn setup_with_confirmations(env: &Env, min_confirmations: u32) -> BtcRelayContractClient {
    let admin = Address::generate(env);
    let token = Address::generate(env);
    let crypto_id = env.register(BtcCryptoContract, ());
    let contract_id = env.register(BtcRelayContract, ());
    let client = BtcRelayContractClient::new(env, &contract_id);
    client.initialize(&admin, &token, &min_confirmations, &crypto_id);
    client
}

fn make_header(env: &Env, merkle_root: &BytesN<32>) -> Bytes {
    make_header_with_prev(env, merkle_root, &BytesN::from_array(env, &[0u8; 32]))
}

/// Same as `make_header` but with an explicit `prev_block_hash` field
/// (bytes 4–35), for the header-chain / reorg tests, which need to link
/// headers together via `submit_header`'s parent lookup. Brute-forces the
/// nonce field (bytes 76–79) until the resulting header hash satisfies the
/// fixed easy target this test module uses (0x207fffff), the same way a
/// real miner would — decouples "does this header pass PoW" from the
/// specific merkle root / prev hash content, which the deterministic
/// tx_id-based approach in `make_header`'s callers can't otherwise
/// guarantee for arbitrary prev-hash chains.
fn make_header_with_prev(env: &Env, merkle_root: &BytesN<32>, prev_hash: &BytesN<32>) -> Bytes {
    let mut header = [0u8; 80];
    header[72] = 0xff;
    header[73] = 0xff;
    header[74] = 0x7f;
    header[75] = 0x20;

    let prev_arr = prev_hash.to_array();
    for i in 0..32 {
        header[4 + i] = prev_arr[i];
    }
    let root_arr = merkle_root.to_array();
    for i in 0..32 {
        header[36 + i] = root_arr[i];
    }

    for nonce in 0u32..10_000u32 {
        let nb = nonce.to_le_bytes();
        header[76] = nb[0];
        header[77] = nb[1];
        header[78] = nb[2];
        header[79] = nb[3];
        let candidate = Bytes::from_slice(env, &header);
        let hash = dsha256(env, &candidate);
        // Target 0x207fffff decodes to a big-endian target whose first
        // byte is 0x7f — hash_meets_target requires hash <= target
        // byte-by-byte from the most significant byte, so checking the
        // first byte here is sufficient given the rest of the target is
        // 0x00 (any hash with first byte < 0x7f passes regardless of the
        // remaining bytes; a first byte == 0x7f would need byte 1 checked
        // too, so this search only accepts a comfortable margin: < 0x7f).
        if hash.to_array()[0] < 0x7f {
            return candidate;
        }
    }
    panic!("could not find a PoW-satisfying nonce within 10,000 attempts");
}

fn dsha256(env: &Env, data: &Bytes) -> BytesN<32> {
    let first: BytesN<32> = env.crypto().sha256(data).into();
    let first_bytes = Bytes::from_slice(env, first.to_array().as_ref());
    env.crypto().sha256(&first_bytes).into()
}

fn single_leaf_proof(env: &Env, tx_id: &BytesN<32>) -> (BytesN<32>, Vec<BytesN<32>>) {
    let mut combined = Bytes::new(env);
    combined.extend_from_slice(tx_id.to_array().as_ref());
    combined.extend_from_slice(tx_id.to_array().as_ref());
    let root = dsha256(env, &combined);

    let mut proof = Vec::new(env);
    proof.push_back(tx_id.clone());
    (root, proof)
}

fn proof_at_depth(
    env: &Env,
    tx_id: &BytesN<32>,
    depth: u32,
) -> (BytesN<32>, Vec<BytesN<32>>) {
    let mut current = tx_id.clone();
    let mut proof = Vec::new(env);

    for _ in 0..depth {
        let sibling = current.clone();
        let mut combined = Bytes::new(env);
        combined.extend_from_slice(current.to_array().as_ref());
        combined.extend_from_slice(sibling.to_array().as_ref());
        current = dsha256(env, &combined);
        proof.push_back(sibling);
    }

    (current, proof)
}

#[test]
fn test_initialize_and_get_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, token, client) = setup(&env);

    let cfg = client.get_config();
    assert_eq!(cfg.admin, admin);
    assert_eq!(cfg.wrapped_btc_token, token);
    assert_eq!(cfg.min_confirmations, 1);
}

#[test]
#[should_panic]
fn test_double_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, token, client) = setup(&env);
    let crypto_id = Address::generate(&env);
    client.initialize(&admin, &token, &1, &crypto_id);
}

#[test]
fn test_valid_spv_proof_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    let recipient = Address::generate(&env);
    let tx_id = BytesN::from_array(&env, &[0xabu8; 32]);
    let (root, proof) = single_leaf_proof(&env, &tx_id);
    let header = make_header(&env, &root);

    let result = client.verify_and_claim(&SpvProof {
        block_header: header,
        tx_id: tx_id.clone(),
        merkle_proof: proof,
        tx_index: 0,
        amount_sat: 100_000_000,
        recipient: recipient.clone(),
    });

    assert_eq!(result.0, recipient);
    assert_eq!(result.1, 100_000_000i128);
    assert!(client.is_claimed(&tx_id));
}

#[test]
#[should_panic]
fn test_replay_attack_blocked() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    let recipient = Address::generate(&env);
    let tx_id = BytesN::from_array(&env, &[0xbbu8; 32]);
    let (root, proof) = single_leaf_proof(&env, &tx_id);
    let header = make_header(&env, &root);

    client.verify_and_claim(&SpvProof {
        block_header: header.clone(),
        tx_id: tx_id.clone(),
        merkle_proof: proof.clone(),
        tx_index: 0,
        amount_sat: 50_000_000,
        recipient: recipient.clone(),
    });
    assert!(client.is_claimed(&tx_id));

    client.verify_and_claim(&SpvProof {
        block_header: header,
        tx_id,
        merkle_proof: proof,
        tx_index: 0,
        amount_sat: 50_000_000,
        recipient,
    });
}

#[test]
#[should_panic]
fn test_invalid_header_length() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    let recipient = Address::generate(&env);
    let tx_id = BytesN::from_array(&env, &[0x01u8; 32]);
    let (_, proof) = single_leaf_proof(&env, &tx_id);

    client.verify_and_claim(&SpvProof {
        block_header: Bytes::from_slice(&env, &[0u8; 40]),
        tx_id,
        merkle_proof: proof,
        tx_index: 0,
        amount_sat: 1,
        recipient,
    });
}

#[test]
#[should_panic]
fn test_invalid_merkle_proof_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    let recipient = Address::generate(&env);
    let tx_id = BytesN::from_array(&env, &[0xddu8; 32]);
    let wrong_root = BytesN::from_array(&env, &[0x00u8; 32]);
    let header = make_header(&env, &wrong_root);

    let mut proof = Vec::new(&env);
    proof.push_back(BytesN::from_array(&env, &[0xeeu8; 32]));

    client.verify_and_claim(&SpvProof {
        block_header: header,
        tx_id,
        merkle_proof: proof,
        tx_index: 0,
        amount_sat: 1,
        recipient,
    });
}

#[test]
#[should_panic]
fn test_insufficient_confirmations() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_confirmations(&env, 6);

    let recipient = Address::generate(&env);
    let tx_id = BytesN::from_array(&env, &[0xffu8; 32]);
    let (root, proof) = single_leaf_proof(&env, &tx_id);
    let header = make_header(&env, &root);

    client.verify_and_claim(&SpvProof {
        block_header: header,
        tx_id,
        merkle_proof: proof,
        tx_index: 0,
        amount_sat: 1,
        recipient,
    });
}

#[test]
fn test_claims_without_header_chain_are_independent_merkle_proofs_only() {
    // Renamed / rewritten from the pre-existing
    // test_deep_reorg_does_not_revert_or_halt_claims, which documented the
    // relay's old behavior when it had NO chain-tracking state at all: any
    // valid Merkle-proof-depth-satisfying proof was accepted independently,
    // with no way to detect a reorg. This PR adds real header-chain
    // tracking (submit_header / get_checkpoint) and reorg/stale-proof
    // detection — see test_reorg_orphans_original_claim_block below for
    // the new behavior when the header chain IS used.
    //
    // This test now documents the remaining, deliberately-preserved case:
    // a caller who never calls submit_header for either block still gets
    // exactly the old behavior (opt-in — see the module doc above
    // set_genesis_checkpoint in lib.rs for why).
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_confirmations(&env, 6);
    let recipient = Address::generate(&env);

    let original_tx = BytesN::from_array(&env, &[0x11u8; 32]);
    let (original_root, original_proof) = proof_at_depth(&env, &original_tx, 6);
    let original_header = make_header(&env, &original_root);

    client.verify_and_claim(&SpvProof {
        block_header: original_header,
        tx_id: original_tx.clone(),
        merkle_proof: original_proof,
        tx_index: 0,
        amount_sat: 1,
        recipient: recipient.clone(),
    });
    assert!(client.is_claimed(&original_tx));

    // A competing branch, represented by a different valid seven-level SPV
    // proof. Neither block was ever submitted via submit_header, so the
    // header-chain checks in verify_and_claim's step 5.5 don't apply, and
    // this is accepted as an independent claim — same as before this PR.
    let competing_tx = BytesN::from_array(&env, &[0x00u8; 32]);
    let (competing_root, competing_proof) = proof_at_depth(&env, &competing_tx, 7);
    let competing_header = make_header(&env, &competing_root);

    client.verify_and_claim(&SpvProof {
        block_header: competing_header,
        tx_id: competing_tx.clone(),
        merkle_proof: competing_proof,
        tx_index: 0,
        amount_sat: 1,
        recipient,
    });

    assert!(client.is_claimed(&original_tx));
    assert!(client.is_claimed(&competing_tx));
}

// ---------------------------------------------------------------------------
// Header chain / checkpoint / reorg / stale-proof tests
// ---------------------------------------------------------------------------
//
// These construct a small linear chain via submit_header, starting from a
// genesis checkpoint, and exercise: normal confirmation, a shallow reorg
// (within max_safe_reorg_depth), a reorg beyond the safety depth (rejected),
// and stale-proof rejection.

const ZERO_HASH_BYTES: [u8; 32] = [0u8; 32];

fn genesis_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &ZERO_HASH_BYTES)
}

/// Set up a relay with a genesis checkpoint at height 0 (hash = all-zero,
/// matching set_genesis_checkpoint's sentinel convention) and the given
/// min_confirmations / max_safe_reorg_depth.
fn setup_with_chain(
    env: &Env,
    min_confirmations: u32,
    max_safe_reorg_depth: u32,
) -> BtcRelayContractClient<'_> {
    let client = setup_with_confirmations(env, min_confirmations);
    client.set_genesis_checkpoint(&genesis_hash(env), &0u32, &0u64);
    client.set_max_safe_reorg_depth(&max_safe_reorg_depth);
    client
}

/// Submit `count` headers extending from `from_hash` at `from_height`,
/// each a plain linear extension (no forking). `seed_start` lets the
/// caller pick a distinct merkle-root family per branch so two calls to
/// this helper produce headers with different hashes even at the same
/// height (needed to construct competing branches for the reorg tests).
fn extend_chain(
    env: &Env,
    client: &BtcRelayContractClient,
    from_hash: &BytesN<32>,
    from_height: u32,
    count: u32,
    seed_start: u8,
) -> (BytesN<32>, u32) {
    let mut prev = from_hash.clone();
    let mut height = from_height;
    for i in 0..count {
        let seed = seed_start.wrapping_add(i as u8);
        let root = BytesN::from_array(env, &[seed; 32]);
        height += 1;
        let header = make_header_with_prev(env, &root, &prev);
        prev = client.submit_header(&header, &height);
    }
    (prev, height)
}

#[test]
fn test_genesis_checkpoint_and_get_checkpoint() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);

    let cp = client.get_checkpoint().unwrap();
    assert_eq!(cp.height, 0);
    assert_eq!(cp.block_hash, genesis_hash(&env));
}

#[test]
#[should_panic]
fn test_double_genesis_checkpoint_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);
    client.set_genesis_checkpoint(&genesis_hash(&env), &0u32, &0u64);
}

#[test]
fn test_submit_header_extends_checkpoint() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);

    let (tip_hash, tip_height) = extend_chain(&env, &client, &genesis_hash(&env), 0, 3, 10);

    let cp = client.get_checkpoint().unwrap();
    assert_eq!(cp.height, 3);
    assert_eq!(cp.height, tip_height);
    assert_eq!(cp.block_hash, tip_hash);
}

#[test]
#[should_panic]
fn test_submit_header_unknown_parent_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);

    let orphan_root = BytesN::from_array(&env, &[0xabu8; 32]);
    let orphan_prev = BytesN::from_array(&env, &[0xcdu8; 32]); // never submitted
    let header = make_header_with_prev(&env, &orphan_root, &orphan_prev);
    client.submit_header(&header, &1u32);
}

#[test]
#[should_panic]
fn test_submit_header_wrong_height_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);

    let root = BytesN::from_array(&env, &[0xabu8; 32]);
    let header = make_header_with_prev(&env, &root, &genesis_hash(&env));
    client.submit_header(&header, &2u32); // should be 1, not 2
}

#[test]
fn test_verify_and_claim_uses_real_confirmation_depth_when_header_tracked() {
    // With min_confirmations = 3: use a Merkle proof deep enough (3) to
    // pass the old, still-unconditionally-enforced Merkle-proof-depth
    // check (step 4), but keep the block only 1-deep in the *tracked*
    // chain — this isolates the new real confirmation-depth check (step
    // 5.5) from the pre-existing Merkle-depth check, demonstrating the
    // exact conflation the issue calls out: Merkle proof depth (a property
    // of one transaction's position in one block) is not the same thing
    // as chain confirmation depth (how many blocks have been mined after
    // that block).
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 3, 6);
    let recipient = Address::generate(&env);

    let tx_id = BytesN::from_array(&env, &[0x01u8; 32]);
    let (root, proof) = proof_at_depth(&env, &tx_id, 3);
    let header = make_header_with_prev(&env, &root, &genesis_hash(&env));
    let block_hash = client.submit_header(&header, &1u32);
    assert_eq!(block_hash, dsha256(&env, &header));

    // Only 1 real confirmation so far (tip is still height 1) — should
    // fail verify_and_claim's real confirmation-depth check even though
    // the Merkle proof itself (depth 3) independently satisfies
    // min_confirmations=3 at step 4, same as it would have before this PR.
    let result = client.try_verify_and_claim(&SpvProof {
        block_header: header.clone(),
        tx_id: tx_id.clone(),
        merkle_proof: proof.clone(),
        tx_index: 0,
        amount_sat: 1,
        recipient: recipient.clone(),
    });
    assert!(result.is_err(), "should fail: only 1 real confirmation, need 3");

    // Extend the chain by 2 more blocks so the tracked block now has 3
    // confirmations (height 1, tip now height 3: 3 - 1 + 1 = 3).
    extend_chain(&env, &client, &block_hash, 1, 2, 100);

    let (_paid_to, _amount) = client.verify_and_claim(&SpvProof {
        block_header: header,
        tx_id: tx_id.clone(),
        merkle_proof: proof,
        tx_index: 0,
        amount_sat: 1,
        recipient,
    });
    assert!(client.is_claimed(&tx_id));
}

#[test]
fn test_shallow_reorg_is_applied_and_orphans_the_old_branch() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);

    // Branch A: genesis -> A1 -> A2 (tip at height 2).
    let (a1_hash, _) = extend_chain(&env, &client, &genesis_hash(&env), 0, 1, 1);
    let (_a2_hash, _) = extend_chain(&env, &client, &a1_hash, 1, 1, 2);
    assert!(!client.is_block_orphaned(&a1_hash));

    // Branch B forks at genesis and overtakes: genesis -> B1 -> B2 -> B3
    // (tip at height 3 > A's height 2) — a 2-block-deep reorg, within the
    // default max_safe_reorg_depth of 6.
    let (b3_hash, b3_height) = extend_chain(&env, &client, &genesis_hash(&env), 0, 3, 200);

    let cp = client.get_checkpoint().unwrap();
    assert_eq!(cp.block_hash, b3_hash);
    assert_eq!(cp.height, b3_height);

    // A's blocks are now orphaned.
    assert!(client.is_block_orphaned(&a1_hash));
}

#[test]
fn test_reorg_orphans_original_claim_block_and_blocks_further_claims_on_it() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);
    let recipient = Address::generate(&env);

    // Branch A: claim a tx at height 1.
    let tx_id = BytesN::from_array(&env, &[0x03u8; 32]);
    let (root, proof) = single_leaf_proof(&env, &tx_id);
    let a1_header = make_header_with_prev(&env, &root, &genesis_hash(&env));
    let a1_hash = client.submit_header(&a1_header, &1u32);

    client.verify_and_claim(&SpvProof {
        block_header: a1_header.clone(),
        tx_id: tx_id.clone(),
        merkle_proof: proof.clone(),
        tx_index: 0,
        amount_sat: 1,
        recipient: recipient.clone(),
    });
    assert!(client.is_claimed(&tx_id));

    // Branch B overtakes A with a longer chain from genesis.
    extend_chain(&env, &client, &genesis_hash(&env), 0, 3, 200);
    assert!(client.is_block_orphaned(&a1_hash));

    // The tx itself stays claimed — see BTC_RELAY_FINALITY.md and the
    // module doc on HeaderRecord: this PR adds detection and blocks
    // FURTHER reliance on the orphaned block, it does not retroactively
    // revert a already-completed claim (unwinding a completed claim would
    // mean clawing back funds already released downstream, which needs
    // its own explicit design — out of scope here, see this PR's caveats).
    assert!(client.is_claimed(&tx_id));

    // A repeat verify_and_claim attempt against the same (now-orphaned)
    // block also fails — though replay protection (tx already claimed)
    // would independently fail this too, so this alone doesn't isolate
    // ProofReferencesOrphanedBlock. See
    // test_verify_and_claim_rejects_unclaimed_tx_on_orphaned_block below
    // for the isolated case (an unclaimed tx on an orphaned block).
    let result = client.try_verify_and_claim(&SpvProof {
        block_header: a1_header,
        tx_id,
        merkle_proof: proof,
        tx_index: 0,
        amount_sat: 1,
        recipient,
    });
    assert!(result.is_err());
}

#[test]
fn test_verify_and_claim_rejects_unclaimed_tx_on_orphaned_block() {
    // Isolates ProofReferencesOrphanedBlock from replay protection: a tx
    // that was never claimed, but whose block gets orphaned by a reorg
    // before the claim is attempted, must still be rejected.
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);
    let recipient = Address::generate(&env);

    let tx_id = BytesN::from_array(&env, &[0x05u8; 32]);
    let (root, proof) = single_leaf_proof(&env, &tx_id);
    let a1_header = make_header_with_prev(&env, &root, &genesis_hash(&env));
    let a1_hash = client.submit_header(&a1_header, &1u32);

    // Reorg away from A before ever claiming the tx.
    extend_chain(&env, &client, &genesis_hash(&env), 0, 3, 200);
    assert!(client.is_block_orphaned(&a1_hash));
    assert!(!client.is_claimed(&tx_id));

    let result = client.try_verify_and_claim(&SpvProof {
        block_header: a1_header,
        tx_id: tx_id.clone(),
        merkle_proof: proof,
        tx_index: 0,
        amount_sat: 1,
        recipient,
    });
    assert!(result.is_err(), "claim against an orphaned block must be rejected");
    assert!(!client.is_claimed(&tx_id));
}

#[test]
#[should_panic]
fn test_reorg_beyond_safety_depth_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    // max_safe_reorg_depth = 2: a competing chain that forks 3+ blocks
    // behind the tip must be rejected rather than applied.
    let client = setup_with_chain(&env, 1, 2);

    // Branch A: genesis -> A1 -> A2 -> A3 -> A4 (tip height 4).
    extend_chain(&env, &client, &genesis_hash(&env), 0, 4, 1);

    // Branch B forks at genesis (4 blocks behind the tip) and would need
    // to be longer than A to overtake — submit 5 to make it the new tip
    // by height, forcing submit_header to walk back to the fork point,
    // which is deeper than max_safe_reorg_depth=2.
    extend_chain(&env, &client, &genesis_hash(&env), 0, 5, 200);
}

#[test]
fn test_reorg_beyond_safety_depth_leaves_checkpoint_unchanged() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 2);

    let (a_tip_hash, a_tip_height) = extend_chain(&env, &client, &genesis_hash(&env), 0, 4, 1);

    // Build branch B's headers one at a time; the first 4 are accepted as
    // non-canonical side branches (they don't exceed the tip height until
    // the 5th), and only the 5th attempt actually triggers the rejected
    // reorg walk — confirm the checkpoint is still branch A's tip
    // throughout, including after the rejected attempt.
    let mut prev = genesis_hash(&env);
    let mut height = 0u32;
    for i in 0..4u32 {
        let seed = 200u8.wrapping_add(i as u8);
        let root = BytesN::from_array(&env, &[seed; 32]);
        height += 1;
        let header = make_header_with_prev(&env, &root, &prev);
        prev = client.submit_header(&header, &height);

        let cp = client.get_checkpoint().unwrap();
        assert_eq!(cp.block_hash, a_tip_hash, "checkpoint should stay on branch A");
        assert_eq!(cp.height, a_tip_height);
    }

    // 5th header on branch B exceeds the tip height (5 > 4) and triggers
    // the reorg walk, which exceeds max_safe_reorg_depth=2 and panics.
    let root = BytesN::from_array(&env, &[204u8; 32]);
    height += 1;
    let header = make_header_with_prev(&env, &root, &prev);
    let result = client.try_submit_header(&header, &height);
    assert!(result.is_err());

    // Checkpoint is still untouched after the rejected attempt.
    let cp = client.get_checkpoint().unwrap();
    assert_eq!(cp.block_hash, a_tip_hash);
    assert_eq!(cp.height, a_tip_height);
}

#[test]
fn test_stale_proof_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);
    client.set_max_stale_depth(&2u32);
    let recipient = Address::generate(&env);

    let tx_id = BytesN::from_array(&env, &[0x06u8; 32]);
    let (root, proof) = single_leaf_proof(&env, &tx_id);
    let header = make_header_with_prev(&env, &root, &genesis_hash(&env));
    let block_hash = client.submit_header(&header, &1u32);

    // Extend the chain 4 more blocks — the tracked-but-unclaimed block at
    // height 1 is now 4 blocks behind the tip (height 5), beyond
    // max_stale_depth=2.
    extend_chain(&env, &client, &block_hash, 1, 4, 50);

    let result = client.try_verify_and_claim(&SpvProof {
        block_header: header,
        tx_id,
        merkle_proof: proof,
        tx_index: 0,
        amount_sat: 1,
        recipient,
    });
    assert!(result.is_err(), "stale proof (4 blocks behind, max_stale_depth=2) must be rejected");
}

#[test]
fn test_pause_blocks_submit_header() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_with_chain(&env, 1, 6);

    client.pause();

    let root = BytesN::from_array(&env, &[0xabu8; 32]);
    let header = make_header_with_prev(&env, &root, &genesis_hash(&env));
    let result = client.try_submit_header(&header, &1u32);
    assert!(result.is_err());
}

#[test]
fn test_update_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, token, client) = setup(&env);

    let new_admin = Address::generate(&env);
    let crypto_id = env.register(BtcCryptoContract, ());
    client.update_config(&Config {
        admin: new_admin.clone(),
        wrapped_btc_token: token.clone(),
        min_confirmations: 6,
        crypto_contract: crypto_id.clone(),
    });

    let cfg = client.get_config();
    assert_eq!(cfg.admin, new_admin);
    assert_eq!(cfg.wrapped_btc_token, token);
    assert_eq!(cfg.min_confirmations, 6);
    assert_eq!(cfg.crypto_contract, crypto_id);
    assert_ne!(cfg.admin, admin);
}









