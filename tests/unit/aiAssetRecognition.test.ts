import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { AIAssetRecognitionService } from "../../src/services/aiAssetRecognition.service";
import { agentLLM } from "../../src/Agents/agent";

// Mock agentLLM
jest.mock("../../src/Agents/agent", () => ({
  agentLLM: {
    callLLM: jest.fn(),
  },
}));

describe("AIAssetRecognitionService", () => {
  let service: AIAssetRecognitionService;

  beforeEach(() => {
    service = new AIAssetRecognitionService();
    jest.clearAllMocks();
  });

  it("should recognize a well-known asset (USDC)", async () => {
    const mockResponse = {
      assetCode: "USDC",
      issuer: "circle.com",
      confidence: 0.95,
      description: "Recognized as USDC from Circle based on the input.",
    };

    (agentLLM.callLLM as jest.Mock).mockResolvedValue(mockResponse);

    const result = await service.recognizeAsset("USDC", "test-user");

    expect(result).not.toBeNull();
    expect(result?.assetCode).toBe("USDC");
    expect(result?.issuer).toBe("circle.com");
    expect(result?.confidence).toBe(0.95);
    expect(agentLLM.callLLM).toHaveBeenCalledWith(
      "test-user",
      expect.any(String),
      "USDC",
      true
    );
  });

  it("should recognize an asset from description", async () => {
    const mockResponse = {
      assetCode: "ARST",
      issuer: "bitera.com",
      confidence: 0.9,
      description: "Recognized as Argentine Peso stablecoin by Bitera.",
    };

    (agentLLM.callLLM as jest.Mock).mockResolvedValue(mockResponse);

    const result = await service.recognizeAsset("the argentine peso stablecoin", "test-user");

    expect(result).not.toBeNull();
    expect(result?.assetCode).toBe("ARST");
    expect(result?.issuer).toBe("bitera.com");
  });

  it("should return null if confidence is too low", async () => {
    const mockResponse = {
      assetCode: "UNKNOWN",
      confidence: 0.3,
      description: "Not sure what this is.",
    };

    (agentLLM.callLLM as jest.Mock).mockResolvedValue(mockResponse);

    const result = await service.recognizeAsset("some random coin", "test-user");

    expect(result).toBeNull();
  });

  it("should handle native asset (XLM)", async () => {
    const mockResponse = {
      assetCode: "XLM",
      issuer: "native",
      confidence: 1.0,
      description: "Stellar Lumens native asset.",
    };

    (agentLLM.callLLM as jest.Mock).mockResolvedValue(mockResponse);

    const result = await service.recognizeAsset("Lumens", "test-user");

    expect(result).not.toBeNull();
    expect(result?.assetCode).toBe("XLM");
    expect(result?.issuer).toBeUndefined(); // 'native' should be converted to undefined
  });

  it("should return null on LLM error", async () => {
    (agentLLM.callLLM as jest.Mock).mockRejectedValue(new Error("LLM Error"));

    const result = await service.recognizeAsset("USDC", "test-user");

    expect(result).toBeNull();
  });
});
