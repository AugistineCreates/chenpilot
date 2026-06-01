import { promptRolloutService } from "../PromptRolloutService";
import { toolRegistry } from "../ToolRegistry";
import { promptVersionService } from "../PromptVersionService";

describe("PromptVersionControl", () => {
  it("should fail compatibility if required tool is missing", async () => {
    // Mock tool registry to have no tools
    jest.spyOn(toolRegistry, "getToolMetadata").mockReturnValue([]);

    // Mock prompt with required tool
    const mockPrompt = {
      id: "p1",
      compatibility: { requiredTools: ["missing_tool"] },
    };

    // Mock repo
    const spy = jest
      .spyOn(
        (
          promptRolloutService as unknown as {
            promptRepo: { findOne: unknown };
          }
        ).promptRepo,
        "findOne" as never
      )
      .mockResolvedValue(mockPrompt as never);

    const result = await promptRolloutService.validateCompatibility("p1");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("missing_tool");

    spy.mockRestore();
  });

  it("should trigger rollback when success rate is below threshold", async () => {
    // Setup prompt with rollback policy
    const mockPrompt = {
      id: "p1",
      rollbackVersionId: "p0",
      rolloutPolicy: {
        autoRollbackThreshold: 80,
        minExecutionsBeforePolicy: 5,
      },
    };

    // Mock metrics with 50% success rate
    jest.spyOn(promptVersionService, "getMetrics").mockResolvedValue({
      total: 10,
      successful: 5,
      successRate: 0.5,
      avgResponseTime: 100,
    });

    jest
      .spyOn(
        (
          promptRolloutService as unknown as {
            promptRepo: { findOne: unknown };
          }
        ).promptRepo,
        "findOne" as never
      )
      .mockResolvedValue(mockPrompt as never);
    const rollbackSpy = jest
      .spyOn(
        promptRolloutService as unknown as {
          performRollback: (id: string) => Promise<void>;
        },
        "performRollback"
      )
      .mockResolvedValue(undefined);

    const result = await promptRolloutService.evaluateRollback("p1");
    expect(result).toBe(true);
    expect(rollbackSpy).toHaveBeenCalled();
  });
});
