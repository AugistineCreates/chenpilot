//! Test-case reduction and trace minimization (shrinking) for failing sequences.
//!
//! When a differential divergence or invariant violation is detected on a long sequence
//! of operations, the minimizer reduces the operation trace to the minimal sub-sequence
//! that still triggers the divergence.

use std::fmt::Debug;

/// Minimizes a failing operation sequence using delta-debugging and greedy removal.
///
/// `original_ops`: The full sequence of operations that failed.
/// `reproduces_failure`: A predicate function that runs the candidate sequence from
/// initial state and returns `true` if and only if the failure/divergence is reproduced.
pub fn minimize_sequence<Op: Clone + Debug, F: Fn(&[Op]) -> bool>(
    original_ops: &[Op],
    reproduces_failure: F,
) -> Vec<Op> {
    if original_ops.is_empty() {
        return Vec::new();
    }

    let mut current = original_ops.to_vec();

    // First pass: try coarse chunk removal (binary/quarter split)
    let mut chunk_size = current.len() / 2;
    while chunk_size > 0 {
        let mut i = 0;
        while i + chunk_size <= current.len() {
            let mut candidate = current.clone();
            candidate.drain(i..i + chunk_size);
            if !candidate.is_empty() && reproduces_failure(&candidate) {
                current = candidate;
                // Recheck from the current position
            } else {
                i += chunk_size;
            }
        }
        chunk_size /= 2;
    }

    // Second pass: fine-grained 1-minimal element removal
    let mut changed = true;
    while changed {
        changed = false;
        let mut i = 0;
        while i < current.len() {
            let mut candidate = current.clone();
            candidate.remove(i);
            if !candidate.is_empty() && reproduces_failure(&candidate) {
                current = candidate;
                changed = true;
                // Check next element at same index
            } else {
                i += 1;
            }
        }
    }

    current
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_minimizer_reduces_to_minimal_failing_ops() {
        // Suppose the bug triggers if and only if operation 3 and 7 are both present.
        let ops = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        let failure_pred = |candidate: &[i32]| {
            candidate.contains(&3) && candidate.contains(&7)
        };

        let minimized = minimize_sequence(&ops, failure_pred);
        assert_eq!(minimized, vec![3, 7]);
    }
}
