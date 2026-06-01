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
const agent_1 = require("../../src/Agents/agent");
jest.mock("@anthropic-ai/sdk");
jest.mock("../../src/config/logger");
describe("Agent Timeout Integration", () => {
  describe("AgentLLM.callLLM with timeout", () => {
    it("should complete LLM call within timeout", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockCreate = jest.fn().mockResolvedValue({
          content: [{ type: "text", text: '{"result": "success"}' }],
        });
        agent_1.agentLLM.client = {
          messages: { create: mockCreate },
        };
        const result = yield agent_1.agentLLM.callLLM(
          "test-agent",
          "test prompt",
          "test input",
          true,
          5000
        );
        expect(result).toEqual({ result: "success" });
      }));
    it("should timeout when LLM call exceeds timeout", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockCreate = jest
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 5000))
          );
        agent_1.agentLLM.client = {
          messages: { create: mockCreate },
        };
        yield expect(
          agent_1.agentLLM.callLLM(
            "test-agent",
            "test prompt",
            "test input",
            true,
            100
          )
        ).rejects.toThrow("LLM call timed out after 100ms");
      }));
    it("should use default timeout from config when not specified", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockCreate = jest.fn().mockResolvedValue({
          content: [{ type: "text", text: '{"result": "success"}' }],
        });
        agent_1.agentLLM.client = {
          messages: { create: mockCreate },
        };
        yield agent_1.agentLLM.callLLM(
          "test-agent",
          "test prompt",
          "test input",
          true
        );
        expect(mockCreate).toHaveBeenCalled();
      }));
    it("should handle non-JSON response with timeout", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockCreate = jest.fn().mockResolvedValue({
          content: [{ type: "text", text: "plain text response" }],
        });
        agent_1.agentLLM.client = {
          messages: { create: mockCreate },
        };
        const result = yield agent_1.agentLLM.callLLM(
          "test-agent",
          "test prompt",
          "test input",
          false,
          5000
        );
        expect(result).toBe("plain text response");
      }));
    it("should handle JSON parse error gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockCreate = jest.fn().mockResolvedValue({
          content: [{ type: "text", text: "invalid json" }],
        });
        agent_1.agentLLM.client = {
          messages: { create: mockCreate },
        };
        const result = yield agent_1.agentLLM.callLLM(
          "test-agent",
          "test prompt",
          "test input",
          true,
          5000
        );
        expect(result).toEqual({});
      }));
  });
});
