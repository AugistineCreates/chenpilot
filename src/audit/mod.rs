//! Audit log anchoring and verification module
//! 
//! Provides cryptographic anchoring of audit logs with signed checkpoints
//! for offline verification and tamper detection.

pub mod merkle;
pub mod checkpoint;
pub mod verifier;

// Re-export commonly used types
pub use merkle::{generate_merkle_root, verify_merkle_proof};
pub use checkpoint::{AuditCheckpoint, SignedCheckpoint, publish_checkpoint, get_latest_checkpoint};
pub use verifier::{AuditVerifier, VerificationResult};
