/**
 * SeededRNG - Seeded Random Number Generator using Mulberry32 algorithm
 *
 * Provides deterministic pseudo-random number generation for reproducible simulations.
 * The Mulberry32 algorithm is fast, high-quality, and suitable for simulation purposes.
 *
 * @see https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
export class SeededRNG {
  private state: number;

  /**
   * Creates a new SeededRNG instance
   *
   * @param seed - The seed value for the random number generator (32-bit unsigned integer)
   */
  constructor(seed: number) {
    // Ensure seed is a 32-bit unsigned integer
    this.state = seed >>> 0;
  }

  /**
   * Generates the next random number in the sequence
   *
   * Uses the Mulberry32 algorithm to generate high-quality pseudo-random numbers.
   * The algorithm maintains internal state and produces deterministic sequences.
   *
   * @returns A floating point value in the range [0, 1)
   */
  next(): number {
    // Mulberry32 algorithm
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const result = ((t ^ (t >>> 14)) >>> 0) / 4294967296;

    return result;
  }

  /**
   * Creates an independent copy of this RNG with the same state
   *
   * The cloned RNG will produce the same sequence of random numbers
   * as this RNG from the current state forward.
   *
   * @returns A new SeededRNG instance with identical state
   */
  clone(): SeededRNG {
    const cloned = new SeededRNG(0);
    cloned.state = this.state;
    return cloned;
  }
}
