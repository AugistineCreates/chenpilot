"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
const feeBumping_1 = require("../feeBumping");
describe("FeeBumpingEngine", () => {
  describe("constructor and configuration", () => {
    it("should create engine with default config", () => {
      const engine = new feeBumping_1.FeeBumpingEngine();
      expect(engine).toBeInstanceOf(feeBumping_1.FeeBumpingEngine);
    });
    it("should create engine with custom strategy", () => {
      const engine = new feeBumping_1.FeeBumpingEngine({
        strategy: "aggressive",
      });
      expect(engine).toBeInstanceOf(feeBumping_1.FeeBumpingEngine);
    });
  });
  describe("getDefaultLimits", () => {
    it("should return default resource limits", () => {
      const limits = feeBumping_1.FeeBumpingEngine.getDefaultLimits();
      expect(limits).toEqual({
        cpuInstructions: 100000000,
        readBytes: 200000,
        writeBytes: 100000,
        readLedgerEntries: 40,
        writeLedgerEntries: 25,
        txSizeByte: 100000,
      });
    });
  });
  describe("estimateFee", () => {
    it("should estimate fee for given limits", () => {
      const engine = new feeBumping_1.FeeBumpingEngine();
      const limits = feeBumping_1.FeeBumpingEngine.getDefaultLimits();
      const fee = engine.estimateFee(limits);
      expect(fee).toBeGreaterThan(0);
      expect(typeof fee).toBe("number");
    });
  });
  describe("calculateAdjustment", () => {
    it("should return null for non-resource errors", () => {
      const engine = new feeBumping_1.FeeBumpingEngine();
      const limits = feeBumping_1.FeeBumpingEngine.getDefaultLimits();
      const result = engine.calculateAdjustment(
        "Network error: connection timeout",
        limits
      );
      expect(result).toBeNull();
    });
    it("should calculate adjustment for CPU instructions error", () => {
      const engine = new feeBumping_1.FeeBumpingEngine();
      const limits = feeBumping_1.FeeBumpingEngine.getDefaultLimits();
      const error = "cpu instructions exceeded 150000000 limit 100000000";
      const adjusted = engine.calculateAdjustment(error, limits);
      expect(adjusted).not.toBeNull();
      expect(adjusted.cpuInstructions).toBeGreaterThan(limits.cpuInstructions);
    });
  });
  describe("bumpAndRetry", () => {
    it("should succeed on first attempt", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const engine = new feeBumping_1.FeeBumpingEngine();
        const mockTx = jest.fn().mockResolvedValue({ hash: "tx123" });
        const result = yield engine.bumpAndRetry(mockTx);
        expect(result.success).toBe(true);
        expect(result.result).toEqual({ hash: "tx123" });
        expect(result.attempts).toHaveLength(0);
        expect(mockTx).toHaveBeenCalledTimes(1);
      }));
    it("should retry on resource error and succeed", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const engine = new feeBumping_1.FeeBumpingEngine();
        const mockTx = jest
          .fn()
          .mockRejectedValueOnce(
            new Error("cpu instructions exceeded 150000000 limit 100000000")
          )
          .mockResolvedValueOnce({ hash: "tx123" });
        const result = yield engine.bumpAndRetry(mockTx);
        expect(result.success).toBe(true);
        expect(result.result).toEqual({ hash: "tx123" });
        expect(result.attempts).toHaveLength(1);
        expect(mockTx).toHaveBeenCalledTimes(2);
      }));
    it("should fail after max attempts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const engine = new feeBumping_1.FeeBumpingEngine({ maxAttempts: 2 });
        const mockTx = jest
          .fn()
          .mockRejectedValue(
            new Error("cpu instructions exceeded 150000000 limit 100000000")
          );
        const result = yield engine.bumpAndRetry(mockTx);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Max retry attempts");
        expect(result.attempts).toHaveLength(2);
        expect(mockTx).toHaveBeenCalledTimes(2);
      }));
    it("should not retry on non-resource errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const engine = new feeBumping_1.FeeBumpingEngine();
        const mockTx = jest
          .fn()
          .mockRejectedValue(new Error("Network error: connection timeout"));
        const result = yield engine.bumpAndRetry(mockTx);
        expect(result.success).toBe(false);
        expect(result.error).toBe("Network error: connection timeout");
        expect(result.attempts).toHaveLength(1);
        expect(mockTx).toHaveBeenCalledTimes(1);
      }));
    it("should use custom initial limits", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const engine = new feeBumping_1.FeeBumpingEngine();
        const customLimits = {
          cpuInstructions: 50000000,
        };
        const mockTx = jest.fn().mockResolvedValue({ hash: "tx123" });
        const result = yield engine.bumpAndRetry(mockTx, customLimits);
        expect(result.success).toBe(true);
        expect(mockTx).toHaveBeenCalledWith(
          expect.objectContaining({
            cpuInstructions: 50000000,
          })
        );
      }));
    it("should call onBump callback when bumping", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const onBump = jest.fn();
        const engine = new feeBumping_1.FeeBumpingEngine({ onBump });
        const mockTx = jest
          .fn()
          .mockRejectedValueOnce(
            new Error("cpu instructions exceeded 150000000 limit 100000000")
          )
          .mockResolvedValueOnce({ hash: "tx123" });
        yield engine.bumpAndRetry(mockTx);
        expect(onBump).toHaveBeenCalledTimes(1);
        expect(onBump).toHaveBeenCalledWith(
          expect.objectContaining({
            attempt: 1,
            previousLimits: expect.any(Object),
            newLimits: expect.any(Object),
            error: expect.any(Object),
          })
        );
      }));
  });
});
