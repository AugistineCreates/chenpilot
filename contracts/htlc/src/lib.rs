#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env, token,
};
use contract_failure::{fail, FailureReason};

// TTL for swap state: swaps auto-expire after the expiry ledger + grace period
// Add 7 days (1_209_600 ledgers at 5s/ledger) beyond expiry for post-claim/refund records
const SWAP_TTL_GRACE_LEDGERS: u32 = 1_209_600;

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Swap(BytesN<32>), // keyed by swap_id
}

// ---------------------------------------------------------------------------
// Swap state
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SwapStatus {
    Active,
    Claimed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Swap {
    /// Party that locked the funds
    pub initiator: Address,
    /// Party that can claim by revealing the secret
    pub recipient: Address,
    /// Token locked in the swap
    pub token: Address,
    /// Amount locked
    pub amount: i128,
    /// SHA-256( secret || recipient_pubkey ) — ties the hash to the recipient
    pub secret_hash: BytesN<32>,
    /// Ledger sequence after which the initiator can refund
    pub expiry_ledger: u32,
    pub status: SwapStatus,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSwapInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub swap_id: BytesN<32>,
    pub initiator: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub expiry_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtClaim {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub swap_id: BytesN<32>,
    pub recipient: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtRefund {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub swap_id: BytesN<32>,
    pub initiator: Address,
    pub amount: i128,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct HtlcContract;

#[contractimpl]
impl HtlcContract {
    /// Lock funds into a new HTLC swap.
    ///
    /// `secret_hash` MUST be SHA-256( preimage || recipient_pubkey_bytes ).
    /// This cryptographically ties the hash to the recipient, preventing an
    /// intercepting agent from claiming with a secret intended for someone else.
    ///
    /// Returns the `swap_id` (SHA-256 of the secret_hash + initiator + expiry).
    pub fn init_swap(
        env: Env,
        initiator: Address,
        recipient: Address,
        token: Address,
        amount: i128,
        secret_hash: BytesN<32>,
        expiry_ledger: u32,
    ) -> BytesN<32> {
        initiator.require_auth();

        if amount <= 0 {
            fail(&env, FailureReason::AmountNotPositive);
        }
        if expiry_ledger <= env.ledger().sequence() {
            fail(&env, FailureReason::ExpiryNotInFuture);
        }

        // Derive a unique swap_id from the parameters
        let swap_id = Self::derive_swap_id(&env, &secret_hash, &initiator, expiry_ledger);

        if env.storage().persistent().has(&DataKey::Swap(swap_id.clone())) {
            fail(&env, FailureReason::SwapAlreadyExists);
        }

        // Pull funds from initiator into the contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&initiator, &env.current_contract_address(), &amount);

        let swap = Swap {
            initiator,
            recipient,
            token,
            amount,
            secret_hash,
            expiry_ledger,
            status: SwapStatus::Active,
        };
        
        // Calculate TTL: expiry + grace period for post-completion records
        let ttl_ledgers = expiry_ledger.saturating_add(SWAP_TTL_GRACE_LEDGERS);
        env.storage().persistent().set_with_ttl(&DataKey::Swap(swap_id.clone()), &swap, ttl_ledgers);

        env.events().publish(
            (symbol_short!("SwapInit"),),
            (swap_id.clone(), initiator.clone(), recipient.clone(), token.clone(), amount, expiry_ledger),
        );
        swap_id
    }

    /// Claim the locked funds by revealing the preimage.
    ///
    /// Verification: SHA-256( preimage || recipient_pubkey_bytes ) == swap.secret_hash
    /// This ensures only the intended recipient can claim, even if the preimage leaks,
    /// because an attacker's pubkey won't match.
    pub fn claim(env: Env, swap_id: BytesN<32>, preimage: Bytes, recipient_pubkey: Bytes) {
        let mut swap: Swap = env
            .storage()
            .persistent()
            .get(&DataKey::Swap(swap_id.clone()))
            .unwrap_or_else(|| fail(&env, FailureReason::NotFound));

        if swap.status != SwapStatus::Active {
            fail(&env, FailureReason::SwapNotActive);
        }
        if env.ledger().sequence() > swap.expiry_ledger {
            fail(&env, FailureReason::SwapExpired);
        }

        // Verify the recipient is who they claim to be
        swap.recipient.require_auth();

        // Recompute the key-bound hash: SHA-256( preimage || recipient_pubkey )
        let mut combined = Bytes::new(&env);
        combined.append(&preimage);
        combined.append(&recipient_pubkey);
        let computed: BytesN<32> = env.crypto().sha256(&combined).into();

        if computed != swap.secret_hash {
            fail(&env, FailureReason::InvalidPreimage);
        }

        swap.status = SwapStatus::Claimed;
        
        // Extend TTL to keep claimed record queryable for grace period
        let ttl_ledgers = swap.expiry_ledger.saturating_add(SWAP_TTL_GRACE_LEDGERS);
        env.storage().persistent().set_with_ttl(&DataKey::Swap(swap_id.clone()), &swap, ttl_ledgers);

        // Release funds to recipient
        let token_client = token::Client::new(&env, &swap.token);
        token_client.transfer(&env.current_contract_address(), &swap.recipient, &swap.amount);

        env.events().publish(
            (symbol_short!("Claimed"),),
            (swap_id.clone(), swap.recipient.clone(), swap.token.clone(), swap.amount),
        );
    }

    /// Refund the locked funds back to the initiator after expiry.
    pub fn refund(env: Env, swap_id: BytesN<32>) {
        let mut swap: Swap = env
            .storage()
            .persistent()
            .get(&DataKey::Swap(swap_id.clone()))
            .unwrap_or_else(|| fail(&env, FailureReason::NotFound));

        if swap.status != SwapStatus::Active {
            fail(&env, FailureReason::SwapNotActive);
        }
        if env.ledger().sequence() <= swap.expiry_ledger {
            fail(&env, FailureReason::SwapNotYetExpired);
        }

        swap.initiator.require_auth();

        swap.status = SwapStatus::Refunded;
        
        // Extend TTL to keep refunded record queryable for grace period
        let ttl_ledgers = swap.expiry_ledger.saturating_add(SWAP_TTL_GRACE_LEDGERS);
        env.storage().persistent().set_with_ttl(&DataKey::Swap(swap_id.clone()), &swap, ttl_ledgers);

        // Return funds to initiator
        let token_client = token::Client::new(&env, &swap.token);
        token_client.transfer(&env.current_contract_address(), &swap.initiator, &swap.amount);

        env.events().publish(
            (symbol_short!("Refunded"),),
            (swap_id.clone(), swap.initiator.clone(), swap.token.clone(), swap.amount),
        );
    }

    /// Returns the swap details for a given swap_id.
    pub fn get_swap(env: Env, swap_id: BytesN<32>) -> Option<Swap> {
        env.storage().persistent().get(&DataKey::Swap(swap_id))
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /// Derives a unique swap ID: SHA-256( secret_hash || initiator_bytes || expiry_le )
    fn derive_swap_id(
        env: &Env,
        secret_hash: &BytesN<32>,
        initiator: &Address,
        expiry_ledger: u32,
    ) -> BytesN<32> {
        let mut data = Bytes::new(env);
        data.extend_from_slice(secret_hash.to_array().as_ref());
        data.extend_from_slice(&initiator.to_array());
        // Encode expiry as 4 little-endian bytes
        data.push_back((expiry_ledger & 0xff) as u8);
        data.push_back(((expiry_ledger >> 8) & 0xff) as u8);
        data.push_back(((expiry_ledger >> 16) & 0xff) as u8);
        data.push_back(((expiry_ledger >> 24) & 0xff) as u8);
        env.crypto().sha256(&data).into()
    }
}

mod test;
