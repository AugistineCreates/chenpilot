import { FeeBumpingEngine, createFeeBumpingEngine } from "../feeBumping";
import { ResourceLimits } from "../types";

describe("FeeBumpingEngine", () => {
  describe("constructor and configuration", () => {
    it("should create engine with default config", () => {
      const engine = new FeeBumpingEngine();
      expect(engine).toBeInstanceOf(FeeBumpingEngine);
    });

    it("should create engine with custom strategy", () => {
      const engine = new FeeBumpingEngine({ strategy: "aggressive" });
      expect(engine).toBeInstanceOf(FeeBumpingEngine);
    });
  });

  describe("getDefaultLimits", () => {
    it("should return default resource limits", () => {
      const limits = FeeBumpingEngine.getDefaultLimits();
      expect(limits).toEqual({
        cpuInstructions: 100_000_000,
        readBytes: 200_000,
        writeBytes: 100_000,
        readLedgerEntries: 40,
        writeLedgerEntries: 25,
        txSizeByte: 100_000,
      });
    });
  });

  describe("estimateFee", () => {
    it("should estimate fee for given limits", () => {
      const engine = new FeeBumpingEngine();
      const limits = FeeBumpingEngine.getDefaultLimits();
      const fee = engine.estimateFee(limits);
      expect(fee).toBeGreaterThan(0);
      expect(typeof fee).toBe("number");
    });
  });

  describe("calculateAdjustment", () => {
    it("should return null for non-resource errors", () => {
      const engine = new FeeBumpingEngine();
      const limits = FeeBumpingEngine.getDefaultLimits();
      const result = engine.calculateAdjustment(
        "Network error: connection timeout",
        limits
      );
      expect(result).toBeNull();
    });

    it("should calculate adjustment for CPU instructions error", () => {
      const engine = new FeeBumpingEngine();
      const limits = FeeBumpingEngine.getDefaultLimits();
      const error = "cpu instructions exceeded 150000000 limit 100000000";

      const adjusted = engine.calculateAdjustment(error, limits);

      expect(adjusted).not.toBeNull();
      expect(adjusted!.cpuInstructions).toBeGreaterThan(limits.cpuInstructions);
    });
  });

  describe("bumpAndRetry", () => {
    it("should succeed on first attempt", async () => {
      const engine = new FeeBumpingEngine();
      const mockTx = jest.fn().mockResolvedValue({ hash: "tx123" });

      const result = await engine.bumpAndRetry(mockTx);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ hash: "tx123" });
      expect(result.attempts).toHaveLength(0);
      expect(mockTx).toHaveBeenCalledTimes(1);
    });

    it("should retry on resource error and succeed", async () => {
      const engine = new FeeBumpingEngine();
      const mockTx = jest
        .fn()
        .mockRejectedValueOnce(
          new Error("cpu instructions exceeded 150000000 limit 100000000")
        )
        .mockResolvedValueOnce({ hash: "tx123" });

      const result = await engine.bumpAndRetry(mockTx);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ hash: "tx123" });
      expect(result.attempts).toHaveLength(1);
      expect(mockTx).toHaveBeenCalledTimes(2);
    });

    it("should fail after max attempts", async () => {
      const engine = new FeeBumpingEngine({ maxAttempts: 2 });
      const mockTx = jest
        .fn()
        .mockRejectedValue(
          new Error("cpu instructions exceeded 150000000 limit 100000000")
        );

      const result = await engine.bumpAndRetry(mockTx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Max retry attempts");
      expect(result.attempts).toHaveLength(2);
      expect(mockTx).toHaveBeenCalledTimes(2);
    });

    it("should not retry on non-resource errors", async () => {
      const engine = new FeeBumpingEngine();
      const mockTx = jest
        .fn()
        .mockRejectedValue(new Error("Network error: connection timeout"));

      const result = await engine.bumpAndRetry(mockTx);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error: connection timeout");
      expect(result.attempts).toHaveLength(1);
      expect(mockTx).toHaveBeenCalledTimes(1);
    });

    it("should use custom initial limits", async () => {
      const engine = new FeeBumpingEngine();
      const customLimits: Partial<ResourceLimits> = {
        cpuInstructions: 50_000_000,
      };
      const mockTx = jest.fn().mockResolvedValue({ hash: "tx123" });

      const result = await engine.bumpAndRetry(mockTx, customLimits);

      expect(result.success).toBe(true);
      expect(mockTx).toHaveBeenCalledWith(
        expect.objectContaining({
          cpuInstructions: 50_000_000,
        })
      );
    });

    it("should call onBump callback when bumping", async () => {
      const onBump = jest.fn();
      const engine = new FeeBumpingEngine({ onBump });
      const mockTx = jest
        .fn()
        .mockRejectedValueOnce(
          new Error("cpu instructions exceeded 150000000 limit 100000000")
        )
        .mockResolvedValueOnce({ hash: "tx123" });

      await engine.bumpAndRetry(mockTx);

      expect(onBump).toHaveBeenCalledTimes(1);
      expect(onBump).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          previousLimits: expect.any(Object),
          newLimits: expect.any(Object),
          error: expect.any(Object),
        })
      );
    });
  });
});
