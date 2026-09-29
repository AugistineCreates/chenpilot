import {
  createBudget,
  withBudget,
  withChildBudget,
  isBudgetExhausted,
  isBudgetExhaustedError,
  budgetedFetch,
  budgetManager,
  BudgetExhaustedError,
  type RequestBudget,
  type BudgetResource,
} from "../budget";

const mockFetch = jest.fn();

describe("Request Budget", () => {
  beforeEach(() => {
    budgetManager.resetMetrics();
    jest.clearAllMocks();
    global.fetch = mockFetch;
  });

  describe("createBudget", () => {
    it("creates a root budget with correct fields", () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 1024,
        downstreamCalls: 5,
        path: "test.path",
      });

      expect(budget.path).toBe("test.path");
      expect(budget.attempts).toBe(3);
      expect(budget.bytes).toBe(1024);
      expect(budget.downstreamCalls).toBe(5);
      expect(budget.deadline).toBeGreaterThan(Date.now());
      expect(budget.consumedAttempts).toBe(0);
      expect(budget.consumedBytes).toBe(0);
      expect(budget.consumedDownstreamCalls).toBe(0);
    });
  });

  describe("withChildBudget", () => {
    it("derives a child with same defaults", () => {
      const parent = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 1024,
        downstreamCalls: 5,
        path: "parent",
      });

      let child: RequestBudget | undefined;
      withChildBudget(parent, (c) => {
        child = c;
      });

      expect(child).toBeDefined();
      expect(child!.attempts).toBe(3);
      expect(child!.bytes).toBe(1024);
      expect(child!.downstreamCalls).toBe(5);
      expect(child!.deadline).toBe(parent.deadline);
    });

    it("throws when child attempts exceed parent", async () => {
      const parent = createBudget({
        deadlineMs: 5000,
        attempts: 2,
        bytes: 1024,
        downstreamCalls: 5,
        path: "parent",
      });

      await expect(
        withChildBudget(parent, () => Promise.resolve(), { attempts: 3 })
      ).rejects.toThrow(BudgetExhaustedError);
    });

    it("throws when child bytes exceed parent", async () => {
      const parent = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 1024,
        downstreamCalls: 5,
        path: "parent",
      });

      await expect(
        withChildBudget(parent, () => Promise.resolve(), { bytes: 2048 })
      ).rejects.toThrow(BudgetExhaustedError);
    });

    it("throws when child downstreamCalls exceed parent", async () => {
      const parent = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 1024,
        downstreamCalls: 2,
        path: "parent",
      });

      await expect(
        withChildBudget(parent, () => Promise.resolve(), { downstreamCalls: 5 })
      ).rejects.toThrow(BudgetExhaustedError);
    });

    it("throws when child deadline exceeds parent", async () => {
      const parent = createBudget({
        deadlineMs: -100,
        attempts: 3,
        bytes: 1024,
        downstreamCalls: 5,
        path: "parent",
      });

      await expect(
        withChildBudget(parent, () => Promise.resolve(), { deadlineMs: 5000 })
      ).rejects.toThrow(BudgetExhaustedError);
    });
  });

  describe("consume", () => {
    it("consumes attempts and throws when exhausted", () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 2,
        bytes: 1024,
        downstreamCalls: 5,
        path: "test",
      });

      withBudget(budget, () => "ok", { resource: "attempts", amount: 1 });
      expect(budget.consumedAttempts).toBe(1);

      expect(() =>
        withBudget(budget, () => "ok", { resource: "attempts", amount: 2 })
      ).toThrow(BudgetExhaustedError);
    });

    it("consumes bytes and throws when exceeded", () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 100,
        downstreamCalls: 5,
        path: "test",
      });

      withBudget(budget, () => "ok", { resource: "bytes", amount: 50 });
      expect(budget.consumedBytes).toBe(50);

      expect(() =>
        withBudget(budget, () => "ok", { resource: "bytes", amount: 51 })
      ).toThrow(BudgetExhaustedError);
    });

    it("consumes downstreamCalls and throws when exceeded", () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 1024,
        downstreamCalls: 2,
        path: "test",
      });

      withBudget(budget, () => "ok", { resource: "downstreamCalls", amount: 1 });
      expect(budget.consumedDownstreamCalls).toBe(1);

      expect(() =>
        withBudget(budget, () => "ok", { resource: "downstreamCalls", amount: 2 })
      ).toThrow(BudgetExhaustedError);
    });

    it("throws deadline error when time has passed", () => {
      const budget = createBudget({
        deadlineMs: -100,
        attempts: 3,
        bytes: 1024,
        downstreamCalls: 5,
        path: "test",
      });

      expect(() =>
        withBudget(budget, () => "ok", { resource: "deadline", amount: 0 })
      ).toThrow(BudgetExhaustedError);
    });
  });

  describe("isBudgetExhausted", () => {
    it("returns true when attempts exhausted", () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 1,
        bytes: 1024,
        downstreamCalls: 5,
        path: "test",
      });

      expect(isBudgetExhausted(budget, "attempts")).toBe(false);
      withBudget(budget, () => "ok", { resource: "attempts", amount: 1 });
      expect(isBudgetExhausted(budget, "attempts")).toBe(true);
    });

    it("returns true when bytes exhausted", () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 10,
        downstreamCalls: 5,
        path: "test",
      });

      expect(isBudgetExhausted(budget, "bytes")).toBe(false);
      withBudget(budget, () => "ok", { resource: "bytes", amount: 10 });
      expect(isBudgetExhausted(budget, "bytes")).toBe(true);
    });
  });

  describe("isBudgetExhaustedError", () => {
    it("identifies BudgetExhaustedError", () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 1024,
        downstreamCalls: 5,
        path: "test",
      });

      let caught: unknown;
      try {
        withBudget(budget, () => "ok", { resource: "attempts", amount: 5 });
      } catch (e) {
        caught = e;
      }

      expect(isBudgetExhaustedError(caught)).toBe(true);
      expect(caught?.resource).toBe("attempts");
      expect(caught?.budget.path).toBe("test");
    });

    it("returns false for non-budget errors", () => {
      expect(isBudgetExhaustedError(new Error("random"))).toBe(false);
      expect(isBudgetExhaustedError(null)).toBe(false);
      expect(isBudgetExhaustedError(undefined)).toBe(false);
    });
  });

  describe("metrics", () => {
    it("records exhaustion metrics per path and resource", () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 1,
        bytes: 10,
        downstreamCalls: 1,
        path: "metrics-test",
      });

      try {
        withBudget(budget, () => "ok", { resource: "bytes", amount: 20 });
      } catch {
        // expected
      }

      try {
        withBudget(budget, () => "ok", { resource: "downstreamCalls", amount: 2 });
      } catch {
        // expected
      }

      const metrics = budgetManager.getMetrics("metrics-test");
      expect(metrics.total).toBe(2);
      expect(metrics.exhausted.bytes).toBe(1);
      expect(metrics.exhausted.downstreamCalls).toBe(1);
    });
  });

  describe("nested retries with budgets", () => {
    it("respects attempt budget across nested operations", async () => {
      const budget = createBudget({
        deadlineMs: 10000,
        attempts: 3,
        bytes: 1024,
        downstreamCalls: 10,
        path: "nested-retry",
      });

      let childCalls = 0;
      const result = await withBudget(budget, async () => {
        while (childCalls < 2) {
          await withBudget(budget, async () => {
            childCalls++;
          }, { resource: "downstreamCalls", amount: 1 });
        }
        return "success";
      }, { resource: "downstreamCalls", amount: 1 });

      expect(result).toBe("success");
      expect(childCalls).toBe(2);
    });

    it("propagates budget exhaustion without retry amplification", async () => {
      const budget = createBudget({
        deadlineMs: 10000,
        attempts: 2,
        bytes: 1024,
        downstreamCalls: 10,
        path: "no-retry-amp",
      });

      let retries = 0;
      const maxRetries = 5;

      for (let i = 0; i < maxRetries; i++) {
        try {
          await withBudget(budget, async () => {
            retries++;
            await withBudget(
              budget,
              () => {
                throw new BudgetExhaustedError("downstream failed", "bytes", budget);
              },
              { resource: "bytes", amount: 500 }
            );
          }, { resource: "bytes", amount: 500 });
          break;
        } catch (error) {
          if (isBudgetExhaustedError(error)) {
            break;
          }
        }
      }

      expect(retries).toBe(1);
    });
  });

  describe("oversized responses", () => {
    it("throws BudgetExhaustedError when response exceeds byte budget", async () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 100,
        downstreamCalls: 5,
        path: "oversized",
      });

      const largeBlob = new Blob(["x".repeat(200)]);
      const mockResponse = new Response(largeBlob, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });

      mockFetch.mockResolvedValueOnce(mockResponse);

      await expect(
        budgetedFetch(budget, "https://example.com/data", { maxBytes: 100 })
      ).rejects.toThrow(BudgetExhaustedError);
    });

    it("allows response within byte budget", async () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 500,
        downstreamCalls: 5,
        path: "within-budget",
      });

      const smallBlob = new Blob(["x".repeat(50)]);
      const mockResponse = new Response(smallBlob, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });

      mockFetch.mockResolvedValueOnce(mockResponse);

      const response = await budgetedFetch(
        budget,
        "https://example.com/data",
        { maxBytes: 500 }
      );

      expect(response.status).toBe(200);
    });

    it("records bytes metric on oversized response", async () => {
      const budget = createBudget({
        deadlineMs: 5000,
        attempts: 3,
        bytes: 100,
        downstreamCalls: 5,
        path: "bytes-metric",
      });

      const largeBlob = new Blob(["x".repeat(200)]);
      const mockResponse = new Response(largeBlob, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });

      mockFetch.mockResolvedValueOnce(mockResponse);

      try {
        await budgetedFetch(budget, "https://example.com/data", { maxBytes: 100 });
      } catch {
        // expected
      }

      const metrics = budgetManager.getMetrics("bytes-metric");
      expect(metrics.exhausted.bytes).toBe(1);
    });
  });
});
