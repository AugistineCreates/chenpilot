import { SeededRNG } from "./SeededRNG";

describe("SeededRNG", () => {
  describe("constructor", () => {
    it("should create an instance with a given seed", () => {
      const rng = new SeededRNG(12345);
      expect(rng).toBeInstanceOf(SeededRNG);
    });

    it("should handle seed value 0", () => {
      const rng = new SeededRNG(0);
      expect(rng).toBeInstanceOf(SeededRNG);
    });

    it("should handle maximum 32-bit unsigned integer seed", () => {
      const rng = new SeededRNG(0xffffffff);
      expect(rng).toBeInstanceOf(SeededRNG);
    });
  });

  describe("next()", () => {
    it("should return a number in the range [0, 1)", () => {
      const rng = new SeededRNG(12345);
      for (let i = 0; i < 100; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it("should produce deterministic sequences for the same seed", () => {
      const rng1 = new SeededRNG(42);
      const rng2 = new SeededRNG(42);

      const sequence1 = Array.from({ length: 10 }, () => rng1.next());
      const sequence2 = Array.from({ length: 10 }, () => rng2.next());

      expect(sequence1).toEqual(sequence2);
    });

    it("should produce different sequences for different seeds", () => {
      const rng1 = new SeededRNG(42);
      const rng2 = new SeededRNG(43);

      const sequence1 = Array.from({ length: 10 }, () => rng1.next());
      const sequence2 = Array.from({ length: 10 }, () => rng2.next());

      expect(sequence1).not.toEqual(sequence2);
    });

    it("should produce different values on consecutive calls", () => {
      const rng = new SeededRNG(12345);
      const value1 = rng.next();
      const value2 = rng.next();
      const value3 = rng.next();

      expect(value1).not.toBe(value2);
      expect(value2).not.toBe(value3);
      expect(value1).not.toBe(value3);
    });

    it("should maintain state across multiple calls", () => {
      const rng1 = new SeededRNG(100);
      const rng2 = new SeededRNG(100);

      // Advance rng1 by 5 calls
      for (let i = 0; i < 5; i++) {
        rng1.next();
      }

      // Get the 6th value from rng1
      const value1 = rng1.next();

      // Advance rng2 by 5 calls
      for (let i = 0; i < 5; i++) {
        rng2.next();
      }

      // Get the 6th value from rng2
      const value2 = rng2.next();

      // They should be equal
      expect(value1).toBe(value2);
    });

    it("should produce uniform distribution (statistical test)", () => {
      const rng = new SeededRNG(999);
      const buckets = new Array(10).fill(0);
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        const value = rng.next();
        const bucket = Math.floor(value * 10);
        buckets[bucket]++;
      }

      // Each bucket should have roughly 1000 values (10% of 10000)
      // Allow for statistical variance: expect each bucket to be within 20% of expected
      const expected = iterations / 10;
      const tolerance = expected * 0.2;

      buckets.forEach((count) => {
        expect(count).toBeGreaterThan(expected - tolerance);
        expect(count).toBeLessThan(expected + tolerance);
      });
    });
  });

  describe("clone()", () => {
    it("should create an independent copy with the same state", () => {
      const rng1 = new SeededRNG(12345);

      // Advance the state
      rng1.next();
      rng1.next();
      rng1.next();

      // Clone at this state
      const rng2 = rng1.clone();

      // Both should produce the same next value
      const value1 = rng1.next();
      const value2 = rng2.next();

      expect(value1).toBe(value2);
    });

    it("should produce identical sequences after cloning", () => {
      const rng1 = new SeededRNG(54321);

      // Advance the state
      for (let i = 0; i < 5; i++) {
        rng1.next();
      }

      // Clone at this state
      const rng2 = rng1.clone();

      // Generate sequences from both
      const sequence1 = Array.from({ length: 10 }, () => rng1.next());
      const sequence2 = Array.from({ length: 10 }, () => rng2.next());

      expect(sequence1).toEqual(sequence2);
    });

    it("should create truly independent copies", () => {
      const rng1 = new SeededRNG(777);
      const rng2 = rng1.clone();

      // Advance rng1
      rng1.next();
      rng1.next();

      // Advance rng2 by different amount
      rng2.next();

      // Now they should produce different values
      const value1 = rng1.next();
      const value2 = rng2.next();

      expect(value1).not.toBe(value2);
    });

    it("should work correctly when cloning at initial state", () => {
      const rng1 = new SeededRNG(888);
      const rng2 = rng1.clone();

      // Both should produce identical sequences from the start
      const sequence1 = Array.from({ length: 5 }, () => rng1.next());
      const sequence2 = Array.from({ length: 5 }, () => rng2.next());

      expect(sequence1).toEqual(sequence2);
    });
  });

  describe("edge cases", () => {
    it("should handle seed value 1", () => {
      const rng = new SeededRNG(1);
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it("should handle negative seed values by converting to unsigned", () => {
      const rng = new SeededRNG(-1);
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it("should produce consistent results for large seeds", () => {
      const largeSeed = 2147483647; // Max 32-bit signed integer
      const rng1 = new SeededRNG(largeSeed);
      const rng2 = new SeededRNG(largeSeed);

      expect(rng1.next()).toBe(rng2.next());
    });

    it("should handle many consecutive calls without degradation", () => {
      const rng = new SeededRNG(12345);
      const values: number[] = [];

      // Generate 1000 values
      for (let i = 0; i < 1000; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        values.push(value);
      }

      // Check that we don't have too many duplicates (should be very rare)
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBeGreaterThan(990); // Allow for some collisions
    });
  });

  describe("determinism validation", () => {
    it("should produce byte-for-byte identical results across multiple runs", () => {
      const seed = 42;
      const iterations = 100;

      // Run 1
      const rng1 = new SeededRNG(seed);
      const results1 = Array.from({ length: iterations }, () => rng1.next());

      // Run 2
      const rng2 = new SeededRNG(seed);
      const results2 = Array.from({ length: iterations }, () => rng2.next());

      // Run 3
      const rng3 = new SeededRNG(seed);
      const results3 = Array.from({ length: iterations }, () => rng3.next());

      // All runs should be identical
      expect(results1).toEqual(results2);
      expect(results2).toEqual(results3);
      expect(results1).toEqual(results3);
    });

    it("should maintain determinism after cloning", () => {
      const seed = 123;

      // Create two RNGs with the same seed
      const rng1 = new SeededRNG(seed);
      const rng2 = new SeededRNG(seed);

      // Advance both to the same state
      for (let i = 0; i < 10; i++) {
        rng1.next();
        rng2.next();
      }

      // Clone both
      const clone1 = rng1.clone();
      const clone2 = rng2.clone();

      // Clones should produce identical sequences
      const sequence1 = Array.from({ length: 20 }, () => clone1.next());
      const sequence2 = Array.from({ length: 20 }, () => clone2.next());

      expect(sequence1).toEqual(sequence2);
    });
  });
});
