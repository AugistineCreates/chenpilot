"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sorobanIntent_1 = require("../../src/Agents/planner/sorobanIntent");
describe("Soroban intent parsing", () => {
  it("detects Soroban intent and extracts fields", () => {
    const input =
      'Invoke soroban contract CABC1234567890 method stake args ["100", 2] on mainnet';
    const plan = (0, sorobanIntent_1.parseSorobanIntent)(input);
    expect(plan).toBeTruthy();
    expect(
      plan === null || plan === void 0 ? void 0 : plan.workflow[0].action
    ).toBe("soroban_invoke");
    expect(
      plan === null || plan === void 0 ? void 0 : plan.workflow[0].payload
    ).toEqual(
      expect.objectContaining({
        network: "mainnet",
        contractId: "CABC1234567890",
        method: "stake",
        args: ["100", 2],
      })
    );
  });
  it("defaults to testnet when network not specified", () => {
    const input = "Call contract CABC1234567890 method lend";
    const plan = (0, sorobanIntent_1.parseSorobanIntent)(input);
    expect(
      plan === null || plan === void 0 ? void 0 : plan.workflow[0].payload
    ).toEqual(
      expect.objectContaining({
        network: "testnet",
        contractId: "CABC1234567890",
        method: "lend",
      })
    );
  });
  it("infers method from keyword when not explicitly provided", () => {
    const input = "stake on soroban contract CABC1234567890";
    const plan = (0, sorobanIntent_1.parseSorobanIntent)(input);
    expect(
      plan === null || plan === void 0 ? void 0 : plan.workflow[0].payload
    ).toEqual(
      expect.objectContaining({
        method: "stake",
      })
    );
  });
});
