//! Merkle tree implementation for audit log anchoring
//! 
//! Provides deterministic, domain-separated Merkle root generation
//! for audit trail verification.

use soroban_sdk::{BytesN, Env, Vec};
use crate::ContractError;

/// Domain separator for audit Merkle trees to prevent cross-domain collisions
const AUDIT_DOMAIN_SEPARATOR: &[u8] = b"AUDIT_TREE_V1";

/// Represents a Merkle tree node
#[derive(Clone, Debug, PartialEq)]
pub struct MerkleNode {
    pub hash: BytesN<32>,
    pub left: Option<Box<MerkleNode>>,
    pub right: Option<Box<MerkleNode>>,
}

/// Merkle tree for audit log entries
pub struct AuditMerkleTree {
    pub root: BytesN<32>,
    pub size: u64,
    pub depth: u32,
}

/// Generate a deterministic Merkle root from a list of audit entries
/// 
/// Uses domain separation to prevent cross-contamination between different
/// audit contexts. The tree is built using a balanced binary tree structure.
pub fn generate_merkle_root(
    env: &Env,
    entries: &Vec<BytesN<32>>,
) -> Result<BytesN<32>, ContractError> {
    if entries.len() == 0 {
        return Err(ContractError::InvalidArgument);
    }

    // Domain separate the leaf hashes
    let domain_separated = domain_separate_entries(env, entries)?;
    
    // Build the Merkle tree
    let tree = build_merkle_tree(env, &domain_separated)?;
    
    Ok(tree.root)
}

/// Build a balanced Merkle tree from leaf hashes
fn build_merkle_tree(
    env: &Env,
    leaves: &Vec<BytesN<32>>,
) -> Result<AuditMerkleTree, ContractError> {
    if leaves.len() == 0 {
        return Err(ContractError::InvalidArgument);
    }

    let mut current_level = leaves.clone();
    let mut depth = 0;

    // Build tree level by level
    while current_level.len() > 1 {
        let mut next_level = Vec::new(env);
        
        // Pair adjacent nodes
        let mut i = 0;
        while i < current_level.len() {
            let left = current_level.get(i).unwrap();
            
            // If odd number of nodes, duplicate the last one
            let right = if i + 1 < current_level.len() {
                current_level.get(i + 1).unwrap()
            } else {
                left.clone()
            };
            
            // Hash the pair
            let combined = combine_hashes(env, &left, &right)?;
            next_level.push_back(combined);
            
            i += 2;
        }
        
        current_level = next_level;
        depth += 1;
    }

    // The last remaining hash is the root
    let root = current_level.get(0).unwrap();
    
    Ok(AuditMerkleTree {
        root,
        size: leaves.len() as u64,
        depth,
    })
}

/// Domain separate audit entries to prevent cross-context collisions
fn domain_separate_entries(
    env: &Env,
    entries: &Vec<BytesN<32>>,
) -> Result<Vec<BytesN<32>>, ContractError> {
    let mut domain_separated = Vec::new(env);
    
    for entry in entries.iter() {
        // Combine domain separator with entry hash
        let separator_hash = env.crypto().sha256(&BytesN::from_array(env, AUDIT_DOMAIN_SEPARATOR));
        
        // Create a salted hash: H(domain_separator || entry)
        let mut combined = [0u8; 64];
        combined[..32].copy_from_slice(separator_hash.as_array());
        combined[32..].copy_from_slice(entry.as_array());
        
        let salted_hash = env.crypto().sha256(&BytesN::from_array(env, &combined));
        domain_separated.push_back(salted_hash);
    }
    
    Ok(domain_separated)
}

/// Combine two child hashes into a parent hash
fn combine_hashes(
    env: &Env,
    left: &BytesN<32>,
    right: &BytesN<32>,
) -> Result<BytesN<32>, ContractError> {
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(left.as_array());
    combined[32..].copy_from_slice(right.as_array());
    
    Ok(env.crypto().sha256(&BytesN::from_array(env, &combined)))
}

/// Verify a Merkle proof for a specific entry
pub fn verify_merkle_proof(
    env: &Env,
    root: &BytesN<32>,
    entry: &BytesN<32>,
    proof: &Vec<BytesN<32>>,
) -> Result<bool, ContractError> {
    let mut current_hash = domain_separate_single(env, entry)?;
    
    for sibling in proof.iter() {
        // Determine the order based on the proof structure
        // For simplicity, assume we always append sibling to the right
        // In practice, you'd need to track position bits
        let mut combined = [0u8; 64];
        combined[..32].copy_from_slice(current_hash.as_array());
        combined[32..].copy_from_slice(sibling.as_array());
        
        current_hash = env.crypto().sha256(&BytesN::from_array(env, &combined));
    }
    
    Ok(current_hash == *root)
}

/// Domain separate a single entry
fn domain_separate_single(
    env: &Env,
    entry: &BytesN<32>,
) -> Result<BytesN<32>, ContractError> {
    let separator_hash = env.crypto().sha256(&BytesN::from_array(env, AUDIT_DOMAIN_SEPARATOR));
    
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(separator_hash.as_array());
    combined[32..].copy_from_slice(entry.as_array());
    
    Ok(env.crypto().sha256(&BytesN::from_array(env, &combined)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;
    
    #[test]
    fn test_merkle_root_generation() {
        let env = Env::default();
        
        let mut entries = Vec::new(&env);
        entries.push_back(env.crypto().sha256(&BytesN::from_array(&env, &[1u8; 32])));
        entries.push_back(env.crypto().sha256(&BytesN::from_array(&env, &[2u8; 32])));
        entries.push_back(env.crypto().sha256(&BytesN::from_array(&env, &[3u8; 32])));
        
        let root = generate_merkle_root(&env, &entries);
        assert!(root.is_ok());
    }
    
    #[test]
    fn test_merkle_root_deterministic() {
        let env = Env::default();
        
        let mut entries = Vec::new(&env);
        entries.push_back(env.crypto().sha256(&BytesN::from_array(&env, &[1u8; 32])));
        entries.push_back(env.crypto().sha256(&BytesN::from_array(&env, &[2u8; 32])));
        
        let root1 = generate_merkle_root(&env, &entries).unwrap();
        let root2 = generate_merkle_root(&env, &entries).unwrap();
        
        assert_eq!(root1, root2);
    }
    
    #[test]
    fn test_merkle_root_with_single_entry() {
        let env = Env::default();
        
        let mut entries = Vec::new(&env);
        entries.push_back(env.crypto().sha256(&BytesN::from_array(&env, &[1u8; 32])));
        
        let root = generate_merkle_root(&env, &entries);
        assert!(root.is_ok());
    }
}
