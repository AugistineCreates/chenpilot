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
const exectutionagent_1 = require("../../src/Agents/agents/exectutionagent");
const ToolRegistry_1 = require("../../src/Agents/registry/ToolRegistry");
jest.mock("../../src/Agents/registry/ToolRegistry");
jest.mock("../../src/Agents/agents/responseagent");
jest.mock("../../src/config/logger");
describe("Execution Agent Timeout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  describe("Agent execution with timeout", () => {
    it("should complete execution within timeout", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockResolvedValue({
          action: "test_action",
          status: "success",
          data: { result: "success" },
        });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
          workflow: [
            {
              action: "test_action",
              payload: { test: "data" },
            },
          ],
        };
        const result = yield exectutionagent_1.executionAgent.run(
          plan,
          "user123",
          "test input",
          10000
        );
        expect(result.success).toBe(true);
        expect(mockExecuteTool).toHaveBeenCalled();
      }));
    it("should timeout when execution exceeds timeout", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 5000))
          );
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
          workflow: [
            {
              action: "slow_action",
              payload: { test: "data" },
            },
          ],
        };
        const result = yield exectutionagent_1.executionAgent.run(
          plan,
          "user123",
          "test input",
          100
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain("timed out");
      }));
    it("should pass remaining time to tool execution", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockResolvedValue({
          action: "test_action",
          status: "success",
          data: {},
        });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
          workflow: [
            {
              action: "action1",
              payload: {},
            },
            {
              action: "action2",
              payload: {},
            },
          ],
        };
        yield exectutionagent_1.executionAgent.run(
          plan,
          "user123",
          "test input",
          10000
        );
        expect(mockExecuteTool).toHaveBeenCalledTimes(2);
        expect(mockExecuteTool).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Object),
          "user123",
          expect.any(Number)
        );
      }));
    it("should handle tool execution errors gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest
          .fn()
          .mockRejectedValueOnce(new Error("Tool failed"))
          .mockResolvedValueOnce({
            action: "action2",
            status: "success",
            data: {},
          });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
          workflow: [
            {
              action: "failing_action",
              payload: {},
            },
            {
              action: "success_action",
              payload: {},
            },
          ],
        };
        const result = yield exectutionagent_1.executionAgent.run(
          plan,
          "user123",
          "test input",
          10000
        );
        expect(result.success).toBe(true);
        expect(mockExecuteTool).toHaveBeenCalledTimes(2);
      }));
    it("should stop execution when remaining time is exhausted", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    action: "test",
                    status: "success",
                    data: {},
                  }),
                200
              )
            )
        );
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
          workflow: [
            { action: "action1", payload: {} },
            { action: "action2", payload: {} },
            { action: "action3", payload: {} },
          ],
        };
        const result = yield exectutionagent_1.executionAgent.run(
          plan,
          "user123",
          "test input",
          300
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain("timed out");
      }));
  });
});
