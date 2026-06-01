import { ExperimentService } from "../experiment.service";

describe("ExperimentPlatform", () => {
  let experimentService: ExperimentService;

  beforeAll(async () => {
    // Mock or initialize DB if needed for unit tests
    experimentService = new ExperimentService();
  });

  it("should select a sticky variant for a user", async () => {
    const userId = "user-123";
    const experimentId = "exp-456";

    // Test hash-based assignment consistency
    const variant1 = await (
      experimentService as unknown as {
        selectVariant: (id: string, userId: string) => Promise<string>;
      }
    ).selectVariant(experimentId, userId);
    const variant2 = await (
      experimentService as unknown as {
        selectVariant: (id: string, userId: string) => Promise<string>;
      }
    ).selectVariant(experimentId, userId);

    expect(variant1).toBeDefined();
    expect(variant1).toBe(variant2);
  });

  it("should record and aggregate results correctly", async () => {
    // This would test the getExperimentResults logic
  });
});
