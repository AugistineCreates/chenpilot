//! Fast, cross-platform deterministic pseudo-random number generator for reproducible fuzzing.

/// Deterministic 64-bit PRNG based on SplitMix64 and XorShift.
/// Guarantees bit-for-bit identical operation sequences across platforms and architectures.
#[derive(Clone, Debug)]
pub struct DeterministicPrng {
    state: u64,
}

impl DeterministicPrng {
    /// Create a new PRNG instance from a 64-bit seed.
    pub fn new(seed: u64) -> Self {
        let initial = if seed == 0 {
            0x9E37_79B9_7F4A_7C15
        } else {
            seed.wrapping_mul(0x9E37_79B9_7F4A_7C15)
        };
        Self { state: initial }
    }

    /// Advance the PRNG state and return the next pseudo-random 64-bit unsigned integer.
    pub fn next_u64(&mut self) -> u64 {
        let mut z = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        self.state = z;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Return the next pseudo-random 32-bit unsigned integer.
    pub fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 32) as u32
    }

    /// Generate an integer within the inclusive range [min, max].
    pub fn gen_range_u64(&mut self, min: u64, max: u64) -> u64 {
        if min >= max {
            return min;
        }
        let range = max - min + 1;
        min + (self.next_u64() % range)
    }

    /// Generate a 128-bit signed integer within the inclusive range [min, max].
    pub fn gen_range_i128(&mut self, min: i128, max: i128) -> i128 {
        if min >= max {
            return min;
        }
        let range = (max - min) as u128 + 1;
        let high = self.next_u64() as u128;
        let low = self.next_u64() as u128;
        let val = ((high << 64) | low) % range;
        min + val as i128
    }

    /// Generate a `usize` index within [min, max].
    pub fn gen_range_usize(&mut self, min: usize, max: usize) -> usize {
        if min >= max {
            return min;
        }
        let range = (max - min + 1) as u64;
        min + (self.next_u64() % range) as usize
    }

    /// Generate a random boolean with 50/50 chance.
    pub fn gen_bool(&mut self) -> bool {
        (self.next_u64() & 1) == 1
    }

    /// Select a random element from a non-empty slice.
    pub fn choose<'a, T>(&mut self, slice: &'a [T]) -> &'a T {
        assert!(!slice.is_empty(), "cannot choose from empty slice");
        let idx = self.gen_range_usize(0, slice.len() - 1);
        &slice[idx]
    }

    /// Select a random index for a slice of given length.
    pub fn choose_index(&mut self, len: usize) -> usize {
        assert!(len > 0, "cannot choose index for length 0");
        self.gen_range_usize(0, len - 1)
    }
}
