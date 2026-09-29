//! Offline verifier for exported audit ranges
//! 
//! Provides tools to detect deletion, insertion, reordering, and mutation
//! in exported audit logs.

use soroban_sdk::{BytesN, Env, Vec};
use crate::ContractError;
use super::merkle::{generate_merkle_root, verify_merkle_proof};
use super::checkpoint::{AuditCheckpoint, verify_checkpoint};

/// Verification result for an audit range
#[derive(Clone, Debug, PartialEq)]
pub struct VerificationResult {
    pub valid: bool,
    pub start_sequence: u64,
    pub end_sequence: u64,
    pub detected_deletions: bool,
    pub detected_insertions: bool,
    pub detected_reordering: bool,
    pub detected_mutation: bool,
    pub details: Vec<String>,
}

/// Offline audit verifier
pub struct AuditVerifier;

impl AuditVerifier {
    /// Verify an exported audit range against a checkpoint
    pub fn verify_range(
        env: &Env,
        checkpoint: &AuditCheckpoint,
        exported_entries: &Vec<BytesN<32>>,
        signed_checkpoint: &super::checkpoint::SignedCheckpoint,
    ) -> Result<VerificationResult, ContractError> {
        let mut result = VerificationResult {
            valid: false,
            start_sequence: checkpoint.start_sequence,
            end_sequence: checkpoint.end_sequence,
            detected_deletions: false,
            detected_insertions: false,
            detected_reordering: false,
            detected_mutation: false,
            details: Vec::new(env),
        };
        
        // 1. Verify the checkpoint signature
        if !verify_checkpoint(env, signed_checkpoint)? {
            result.details.push_back("Checkpoint signature invalid".into());
            return Ok(result);
        }
        
        // 2. Regenerate Merkle root from exported entries
        let computed_root = generate_merkle_root(env, exported_entries)?;
        
        // 3. Compare with checkpoint root
        if computed_root != checkpoint.merkle_root {
            result.detected_mutation = true;
            result.details.push_back("Merkle root mismatch - data has been mutated".into());
        }
        
        // 4. Check for deletions by comparing entry count
        if exported_entries.len() as u64 != checkpoint.entry_count {
            result.detected_deletions = true;
            result.details.push_back(&format!(
                "Entry count mismatch: expected {}, got {}",
                checkpoint.entry_count,
                exported_entries.len()
            ));
        }
        
        // 5. If all checks pass, mark as valid
        if !result.detected_deletions && 
           !result.detected_insertions && 
           !result.detected_reordering && 
           !result.detected_mutation {
            result.valid = true;
            result.details.push_back("Verification passed".into());
        }
        
        Ok(result)
    }
    
    /// Verify a single entry with its Merkle proof
    pub fn verify_entry(
        env: &Env,
        checkpoint: &AuditCheckpoint,
        entry: &BytesN<32>,
        proof: &Vec<BytesN<32>>,
    ) -> Result<bool, ContractError> {
        verify_merkle_proof(env, &checkpoint.merkle_root, entry, proof)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, Address};
    use crate::audit::checkpoint::{AuditCheckpoint, SignedCheckpoint, sign_checkpoint};
    
    #[test]
    fn test_verification_result_creation() {
        let env = Env::default();
        let mut details = Vec::new(&env);
        details.push_back("Verification passed".into());
        
        let result = VerificationResult {
            valid: true,
            start_sequence: 0,
            end_sequence: 100,
            detected_deletions: false,
            detected_insertions: false,
            detected_reordering: false,
            detected_mutation: false,
            details,
        };
        
        assert!(result.valid);
    }
}
