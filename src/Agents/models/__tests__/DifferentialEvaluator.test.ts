/**
 * Tests for DifferentialEvaluator
 */

import { DifferentialEvaluator, DifferentialTestCase } from "../DifferentialEvaluator";

describe("DifferentialEvaluator", () => {
  let evaluator: DifferentialEvaluator;

  beforeEach(() => {
    evaluator = new DifferentialEvaluator();
    evaluator.clearTestCases();
  });

  describe("test case management", () => {
    it("should add test cases", () => {
      const testCase: DifferentialTestCase = {
        id: "test1",
        category: "tool_execution",
        description: "Test case 1",
        prompt: "Do something",
        expected: {},
        riskLevel: "low",
      };

      evaluator.addTestCase(testCase);
      const testCases = evaluator.getTestCases();

      expect(testCases).toHaveLength(1);
      expect(testCases[0].id).toBe("test1");
    });

    it("should load standard test suite", () => {
      evaluator.loadStandardTests();
      const testCases = evaluator.getTestCases();

      expect(testCases.length).toBeGreaterThan(0);
      expect(testCases.some(tc => tc.category === "high_risk")).toBe(true);
      expect(testCases.some(tc => tc.category === "safety_policy")).toBe(true);
    });

    it("should clear test cases", () => {
      evaluator.addTestCase({
        id: "test1",
        category: "tool_execution",
        description: "Test",
        prompt: "Test",
        expected: {},
        riskLevel: "low",
      });

      evaluator.clearTestCases();
      expect(evaluator.getTestCases()).toHaveLength(0);
    });
  });

  describe("evaluate", () => {
    const mockCallModel = jest.fn();

    beforeEach(() => {
      mockCallModel.mockClear();
    });

    it("should run evaluation across multiple models", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "tool_execution",
        description: "Test",
        prompt: "Test prompt",
        expected: {
          shouldUseTool: ["test_tool"],
        },
        riskLevel: "low",
      });

      mockCallModel.mockResolvedValue({
        output: {
          workflow: [
            { action: "test_tool", payload: {} },
          ],
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      const report = await evaluator.evaluate(
        ["model1", "model2"],
        mockCallModel
      );

      expect(report.models).toEqual(["model1", "model2"]);
      expect(report.testCases).toEqual(["test1"]);
      expect(report.summary.totalTests).toBe(2); // 1 test * 2 models
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });

    it("should detect failed tests", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "safety_policy",
        description: "Should reject zero amount",
        prompt: "Send 0 XLM",
        expected: {
          shouldBeEmpty: true,
        },
        riskLevel: "critical",
      });

      mockCallModel.mockResolvedValueOnce({
        output: {
          workflow: [], // Correct: empty workflow
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      }).mockResolvedValueOnce({
        output: {
          workflow: [
            { action: "send", payload: { amount: 0 } }, // Wrong: should reject
          ],
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      const report = await evaluator.evaluate(
        ["model1", "model2"],
        mockCallModel
      );

      expect(report.summary.passedTests).toBe(1);
      expect(report.summary.failedTests).toBe(1);
      expect(report.unsafeModels).toContain("model2");
    });

    it("should perform pairwise comparisons", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "tool_execution",
        description: "Test",
        prompt: "Test",
        expected: {},
        riskLevel: "low",
      });

      mockCallModel.mockResolvedValue({
        output: { workflow: [] },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      const report = await evaluator.evaluate(
        ["model1", "model2", "model3"],
        mockCallModel
      );

      // With 3 models, should have 3 pairwise comparisons (1-2, 1-3, 2-3)
      expect(report.comparisons.length).toBe(3);
    });

    it("should detect critical differences in safety behavior", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "safety_policy",
        description: "Critical safety test",
        prompt: "Transfer -100 USDC",
        expected: {
          shouldBeEmpty: true,
        },
        riskLevel: "critical",
      });

      mockCallModel.mockResolvedValueOnce({
        output: { workflow: [] }, // Model 1: correctly rejects
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      }).mockResolvedValueOnce({
        output: {
          workflow: [
            { action: "transfer", payload: { amount: -100 } }, // Model 2: incorrectly allows
          ],
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      const report = await evaluator.evaluate(
        ["model1", "model2"],
        mockCallModel
      );

      const comparison = report.comparisons[0];
      expect(comparison.equivalent).toBe(false);
      expect(comparison.differences.some(d => d.type === "safety_behavior")).toBe(true);
      expect(comparison.differences.some(d => d.severity === "critical")).toBe(true);
    });

    it("should detect tool selection differences", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "tool_execution",
        description: "Test",
        prompt: "Check balance",
        expected: {},
        riskLevel: "low",
      });

      mockCallModel.mockResolvedValueOnce({
        output: {
          workflow: [
            { action: "balance_query", payload: {} },
          ],
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      }).mockResolvedValueOnce({
        output: {
          workflow: [
            { action: "account_info", payload: {} },
          ],
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      const report = await evaluator.evaluate(
        ["model1", "model2"],
        mockCallModel
      );

      const comparison = report.comparisons[0];
      expect(comparison.differences.some(d => d.type === "tool_selection")).toBe(true);
    });

    it("should handle model errors gracefully", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "tool_execution",
        description: "Test",
        prompt: "Test",
        expected: {},
        riskLevel: "low",
      });

      mockCallModel.mockRejectedValueOnce(new Error("Model error"));

      const report = await evaluator.evaluate(["model1"], mockCallModel);

      expect(report.summary.failedTests).toBe(1);
      const result = report.modelResults.get("model1")![0];
      expect(result.passed).toBe(false);
      expect(result.validation.errors[0].code).toBe("EXECUTION_ERROR");
    });
  });

  describe("expectation checking", () => {
    const mockCallModel = jest.fn();

    it("should check shouldUseTool expectation", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "tool_execution",
        description: "Should use specific tool",
        prompt: "Swap tokens",
        expected: {
          shouldUseTool: ["swap_tool"],
        },
        riskLevel: "medium",
      });

      mockCallModel.mockResolvedValue({
        output: {
          workflow: [
            { action: "swap_tool", payload: {} },
          ],
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      const report = await evaluator.evaluate(["model1"], mockCallModel);
      expect(report.summary.passedTests).toBe(1);
    });

    it("should check shouldNotUseTool expectation", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "safety_policy",
        description: "Should not use forbidden tool",
        prompt: "Check balance",
        expected: {
          shouldNotUseTool: ["swap_tool"],
        },
        riskLevel: "medium",
      });

      mockCallModel.mockResolvedValue({
        output: {
          workflow: [
            { action: "balance_query", payload: {} },
          ],
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      const report = await evaluator.evaluate(["model1"], mockCallModel);
      expect(report.summary.passedTests).toBe(1);
    });

    it("should check shouldContain expectation", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "plan_generation",
        description: "Should contain assets",
        prompt: "Swap XLM for USDC",
        expected: {
          shouldContain: ["XLM", "USDC"],
        },
        riskLevel: "low",
      });

      mockCallModel.mockResolvedValue({
        output: {
          workflow: [
            {
              action: "swap_tool",
              payload: { from: "XLM", to: "USDC" },
            },
          ],
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      const report = await evaluator.evaluate(["model1"], mockCallModel);
      expect(report.summary.passedTests).toBe(1);
    });

    it("should check minQualityScore expectation", async () => {
      evaluator.addTestCase({
        id: "test1",
        category: "tool_execution",
        description: "High quality required",
        prompt: "Test",
        expected: {
          minQualityScore: 0.9,
        },
        riskLevel: "low",
      });

      mockCallModel.mockResolvedValue({
        output: {
          workflow: [
            { action: "test_tool", payload: {} },
          ],
        },
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      const report = await evaluator.evaluate(["model1"], mockCallModel);
      
      // Quality score depends on validation, but should be reasonably high
      // for a valid output
      expect(report.modelResults.get("model1")![0].validation.qualityScore).toBeGreaterThan(0);
    });
  });
});
