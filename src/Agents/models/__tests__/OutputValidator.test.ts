/**
 * Tests for OutputValidator
 */

import { OutputValidator } from "../OutputValidator";
import { OutputFormat, PlanVersion } from "../ModelCapability";
import { toolRegistry } from "../../registry/ToolRegistry";

// Mock tool registry
jest.mock("../../registry/ToolRegistry", () => ({
  toolRegistry: {
    getTool: jest.fn(),
  },
}));

describe("OutputValidator", () => {
  let validator: OutputValidator;

  beforeEach(() => {
    validator = new OutputValidator();
    jest.clearAllMocks();
  });

  describe("format validation", () => {
    it("should validate JSON format", () => {
      const output = { workflow: [] };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail on non-JSON format", () => {
      const output = "not an object";
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("INVALID_FORMAT");
    });
  });

  describe("plan version validation", () => {
    it("should validate V1 workflow structure", () => {
      const output = {
        workflow: [
          { action: "test_action", payload: {} },
        ],
      };
      const result = validator.validate(
        output,
        OutputFormat.JSON,
        PlanVersion.V1_WORKFLOW
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail when workflow is missing for V1", () => {
      const output = { notWorkflow: [] };
      const result = validator.validate(
        output,
        OutputFormat.JSON,
        PlanVersion.V1_WORKFLOW
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("MISSING_WORKFLOW");
    });

    it("should warn when riskAssessment is missing for V2", () => {
      const output = {
        workflow: [
          { action: "test_action", payload: {} },
        ],
      };
      const result = validator.validate(
        output,
        OutputFormat.JSON,
        PlanVersion.V2_RISK_AWARE
      );

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: "MISSING_RISK_ASSESSMENT" })
      );
    });
  });

  describe("workflow validation", () => {
    beforeEach(() => {
      (toolRegistry.getTool as jest.Mock).mockReturnValue({
        metadata: {
          name: "test_tool",
          parameters: {
            amount: {
              type: "number",
              description: "Amount",
              required: true,
            },
            asset: {
              type: "string",
              description: "Asset",
              required: false,
            },
          },
        },
      });
    });

    it("should validate empty workflow", () => {
      const output = { workflow: [] };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: "EMPTY_WORKFLOW" })
      );
    });

    it("should validate correct workflow steps", () => {
      const output = {
        workflow: [
          {
            action: "test_tool",
            payload: { amount: 100 },
          },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail when action is missing", () => {
      const output = {
        workflow: [
          { payload: {} },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("MISSING_ACTION");
    });

    it("should fail when payload is missing", () => {
      const output = {
        workflow: [
          { action: "test_tool" },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("MISSING_PAYLOAD");
    });

    it("should fail when tool is unknown", () => {
      (toolRegistry.getTool as jest.Mock).mockReturnValue(undefined);

      const output = {
        workflow: [
          { action: "unknown_tool", payload: {} },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("UNKNOWN_TOOL");
      expect(result.semanticIssues[0].type).toBe("unexpected_tool");
    });

    it("should fail when required parameter is missing", () => {
      const output = {
        workflow: [
          {
            action: "test_tool",
            payload: {}, // Missing required 'amount'
          },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("MISSING_REQUIRED_PARAM");
    });

    it("should fail when parameter type is wrong", () => {
      const output = {
        workflow: [
          {
            action: "test_tool",
            payload: { amount: "not a number" },
          },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("TYPE_MISMATCH");
    });

    it("should warn about unexpected parameters", () => {
      const output = {
        workflow: [
          {
            action: "test_tool",
            payload: {
              amount: 100,
              unexpectedParam: "value",
            },
          },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: "UNEXPECTED_PARAM" })
      );
    });
  });

  describe("semantic validation", () => {
    beforeEach(() => {
      (toolRegistry.getTool as jest.Mock).mockReturnValue({
        metadata: {
          name: "test_tool",
          parameters: {
            amount: {
              type: "number",
              description: "Amount",
              required: true,
            },
          },
        },
      });
    });

    it("should detect suspiciously large amounts", () => {
      const output = {
        workflow: [
          {
            action: "test_tool",
            payload: { amount: 10000000 },
          },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.semanticIssues).toContainEqual(
        expect.objectContaining({ type: "suspicious_value" })
      );
    });

    it("should detect zero or negative amounts", () => {
      const output = {
        workflow: [
          {
            action: "test_tool",
            payload: { amount: 0 },
          },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.semanticIssues).toContainEqual(
        expect.objectContaining({
          type: "suspicious_value",
          description: expect.stringContaining("Non-positive"),
        })
      );
    });

    it("should check semantic consistency with user input", () => {
      const output = {
        workflow: [
          {
            action: "test_tool",
            payload: { amount: 100 },
          },
        ],
      };
      const result = validator.validate(
        output,
        OutputFormat.JSON,
        undefined,
        { userInput: "swap XLM for USDC" }
      );

      expect(result.semanticIssues).toContainEqual(
        expect.objectContaining({ type: "missing_context" })
      );
    });
  });

  describe("quality score", () => {
    beforeEach(() => {
      (toolRegistry.getTool as jest.Mock).mockReturnValue({
        metadata: {
          name: "test_tool",
          parameters: {},
        },
      });
    });

    it("should give high score for valid output", () => {
      const output = {
        workflow: [
          { action: "test_tool", payload: {} },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.qualityScore).toBeGreaterThan(0.9);
    });

    it("should reduce score for errors", () => {
      const output = {
        workflow: [
          { action: "test_tool" }, // Missing payload
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.qualityScore).toBeLessThan(0.7);
    });

    it("should reduce score for warnings", () => {
      const output = {
        workflow: [
          {
            action: "test_tool",
            payload: { unexpected: "param" },
          },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.qualityScore).toBeLessThan(1.0);
    });

    it("should reduce score for semantic issues", () => {
      (toolRegistry.getTool as jest.Mock).mockReturnValue({
        metadata: {
          name: "test_tool",
          parameters: {
            amount: { type: "number", description: "Amount", required: true },
          },
        },
      });

      const output = {
        workflow: [
          {
            action: "test_tool",
            payload: { amount: 0 }, // Suspicious value
          },
        ],
      };
      const result = validator.validate(output, OutputFormat.JSON);

      expect(result.qualityScore).toBeLessThan(1.0);
    });
  });
});
