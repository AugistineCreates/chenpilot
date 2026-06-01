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
const timeout_1 = require("../../src/utils/timeout");
describe("Timeout Utility", () => {
  describe("withTimeout", () => {
    it("should resolve when promise completes within timeout", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const promise = Promise.resolve("success");
        const result = yield (0, timeout_1.withTimeout)(promise, {
          timeoutMs: 1000,
          operation: "test_operation",
        });
        expect(result).toBe("success");
      }));
    it("should reject with TimeoutError when promise exceeds timeout", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const promise = new Promise((resolve) => setTimeout(resolve, 2000));
        yield expect(
          (0, timeout_1.withTimeout)(promise, {
            timeoutMs: 100,
            operation: "slow_operation",
          })
        ).rejects.toThrow(timeout_1.TimeoutError);
      }));
    it("should call onTimeout callback when timeout occurs", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const onTimeout = jest.fn();
        const promise = new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          yield (0, timeout_1.withTimeout)(promise, {
            timeoutMs: 100,
            operation: "test_operation",
            onTimeout,
          });
        } catch (_a) {
          // Expected to throw
        }
        expect(onTimeout).toHaveBeenCalled();
      }));
    it("should include operation name in TimeoutError", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const promise = new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          yield (0, timeout_1.withTimeout)(promise, {
            timeoutMs: 100,
            operation: "custom_operation",
          });
        } catch (error) {
          expect(error).toBeInstanceOf(timeout_1.TimeoutError);
          if (error instanceof timeout_1.TimeoutError) {
            expect(error.operation).toBe("custom_operation");
            expect(error.timeoutMs).toBe(100);
          }
        }
      }));
    it("should handle promise rejection", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const promise = Promise.reject(new Error("Test error"));
        yield expect(
          (0, timeout_1.withTimeout)(promise, {
            timeoutMs: 1000,
            operation: "failing_operation",
          })
        ).rejects.toThrow("Test error");
      }));
    it("should abort when signal is already aborted", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const controller = new AbortController();
        controller.abort();
        const promise = Promise.resolve("success");
        yield expect(
          (0, timeout_1.withTimeout)(promise, {
            timeoutMs: 1000,
            operation: "aborted_operation",
            signal: controller.signal,
          })
        ).rejects.toThrow(timeout_1.TimeoutError);
      }));
    it("should abort when signal is aborted during execution", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const controller = new AbortController();
        const promise = new Promise((resolve) => setTimeout(resolve, 2000));
        setTimeout(() => controller.abort(), 100);
        yield expect(
          (0, timeout_1.withTimeout)(promise, {
            timeoutMs: 5000,
            operation: "abort_during_execution",
            signal: controller.signal,
          })
        ).rejects.toThrow(timeout_1.TimeoutError);
      }));
  });
  describe("TimeoutManager", () => {
    let manager;
    beforeEach(() => {
      manager = new timeout_1.TimeoutManager();
    });
    it("should execute operation successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const promise = Promise.resolve("success");
        const result = yield manager.execute("op1", promise, {
          timeoutMs: 1000,
          operation: "test_operation",
        });
        expect(result).toBe("success");
        expect(manager.isActive("op1")).toBe(false);
      }));
    it("should track active operations", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const promise = new Promise((resolve) => setTimeout(resolve, 1000));
        const execution = manager.execute("op1", promise, {
          timeoutMs: 2000,
          operation: "test_operation",
        });
        expect(manager.isActive("op1")).toBe(true);
        expect(manager.getActiveOperations()).toContain("op1");
        yield execution;
        expect(manager.isActive("op1")).toBe(false);
      }));
    it("should abort specific operation", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const promise = new Promise((resolve) => setTimeout(resolve, 2000));
        const execution = manager.execute("op1", promise, {
          timeoutMs: 5000,
          operation: "test_operation",
        });
        setTimeout(() => manager.abort("op1"), 100);
        yield expect(execution).rejects.toThrow(timeout_1.TimeoutError);
        expect(manager.isActive("op1")).toBe(false);
      }));
    it("should abort all operations", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const promise1 = new Promise((resolve) => setTimeout(resolve, 2000));
        const promise2 = new Promise((resolve) => setTimeout(resolve, 2000));
        const execution1 = manager.execute("op1", promise1, {
          timeoutMs: 5000,
          operation: "operation_1",
        });
        const execution2 = manager.execute("op2", promise2, {
          timeoutMs: 5000,
          operation: "operation_2",
        });
        expect(manager.getActiveOperations()).toHaveLength(2);
        manager.abortAll();
        yield expect(execution1).rejects.toThrow(timeout_1.TimeoutError);
        yield expect(execution2).rejects.toThrow(timeout_1.TimeoutError);
        expect(manager.getActiveOperations()).toHaveLength(0);
      }));
    it("should return false when aborting non-existent operation", () => {
      const result = manager.abort("non_existent");
      expect(result).toBe(false);
    });
    it("should handle multiple operations with same ID sequentially", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const promise1 = Promise.resolve("first");
        const result1 = yield manager.execute("op1", promise1, {
          timeoutMs: 1000,
          operation: "first_operation",
        });
        expect(result1).toBe("first");
        const promise2 = Promise.resolve("second");
        const result2 = yield manager.execute("op1", promise2, {
          timeoutMs: 1000,
          operation: "second_operation",
        });
        expect(result2).toBe("second");
      }));
  });
  describe("TimeoutError", () => {
    it("should create error with correct properties", () => {
      const error = new timeout_1.TimeoutError("Test timeout", "test_op", 5000);
      expect(error.name).toBe("TimeoutError");
      expect(error.message).toBe("Test timeout");
      expect(error.operation).toBe("test_op");
      expect(error.timeoutMs).toBe(5000);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
