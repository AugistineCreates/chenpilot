/**
 * Tests for the transaction inspection / simulation report format (#571).
 */

import {
  buildInspectionReport,
  serializeInspectionReport,
  INSPECTION_REPORT_VERSION,
  OperationSummary,
} from "../inspectionReport";

const ops: OperationSummary[] = [
  {
    index: 0,
    type: "invokehostfunction",
    description: "invokeHostFunction: transfer",
  },
  { index: 1, type: "payment", description: "payment: 10 XLM" },
];

const fixedNow = () => 1700000000000;

describe("buildInspectionReport", () => {
  it("produces an ok report with a computed fee estimate for a successful simulation", () => {
    const report = buildInspectionReport({
      operations: ops,
      simulation: { success: true, minResourceFee: "1000" },
      baseFeePerOp: 100,
      signers: [{ key: "GSOURCE", reason: "source account" }],
      now: fixedNow,
    });

    expect(report.version).toBe(INSPECTION_REPORT_VERSION);
    expect(report.status).toBe("ok");
    // resourceFee(1000) + baseFee(100) * 2 ops = 1200 recommended.
    expect(report.feeEstimate.recommended).toBe("1200");
    expect(report.feeEstimate.min).toBe("1200");
    expect(report.feeEstimate.max).toBe("1800"); // default max multiplier 1.5
    expect(report.feeEstimate.currency).toBe("stroops");
    expect(report.executionSummary.willLikelySucceed).toBe(true);
    expect(report.executionSummary.operationCount).toBe(2);
    expect(report.executionSummary.signerCount).toBe(1);
    expect(report.generatedAt).toBe(1700000000000);
    expect(report.warnings).toEqual([]);
  });

  it("marks the report as error and adds a warning when simulation fails", () => {
    const report = buildInspectionReport({
      operations: ops,
      simulation: {
        success: false,
        errorCode: "TX_SIMULATION_FAILED",
        errorMessage: "trap",
      },
      signers: [{ key: "G1" }],
      now: fixedNow,
    });
    expect(report.status).toBe("error");
    expect(report.executionSummary.willLikelySucceed).toBe(false);
    expect(report.warnings.some((w) => w.code === "SIMULATION_FAILED")).toBe(
      true
    );
    expect(report.executionSummary.headline).toMatch(/Will fail/);
  });

  it("warns when there are no operations and no signers", () => {
    const report = buildInspectionReport({
      operations: [],
      simulation: { success: true },
      signers: [],
      now: fixedNow,
    });
    expect(report.warnings.map((w) => w.code).sort()).toEqual([
      "NO_OPERATIONS",
      "NO_SIGNERS",
    ]);
    expect(report.status).toBe("warning");
    // inclusion fee still counts at least one operation slot.
    expect(report.feeEstimate.recommended).toBe("100");
  });

  it("applies custom fee multipliers deterministically", () => {
    const report = buildInspectionReport({
      operations: [ops[0]],
      simulation: { success: true, minResourceFee: "900" },
      baseFeePerOp: 100,
      feeMultipliers: { min: 1, recommended: 1.1, max: 2 },
      signers: [{ key: "G1" }],
      now: fixedNow,
    });
    // raw = 900 + 100 = 1000
    expect(report.feeEstimate.min).toBe("1000");
    expect(report.feeEstimate.recommended).toBe("1100");
    expect(report.feeEstimate.max).toBe("2000");
  });

  it("decodes raw operation XDRs with an injected explainer", () => {
    const report = buildInspectionReport({
      operationXdrs: ["xdr-a", "xdr-b"],
      explainOperation: (_xdr, i) => `payment: op ${i}`,
      simulation: { success: true, minResourceFee: "0" },
      signers: [{ key: "G1" }],
      now: fixedNow,
    });
    expect(report.operations).toHaveLength(2);
    expect(report.operations[0]).toEqual({
      index: 0,
      type: "payment",
      description: "payment: op 0",
    });
  });

  it("serializes to stable JSON", () => {
    const report = buildInspectionReport({
      operations: ops,
      simulation: { success: true, minResourceFee: "1000" },
      signers: [{ key: "G1" }],
      now: fixedNow,
    });
    const json = serializeInspectionReport(report);
    expect(JSON.parse(json)).toEqual(report);
  });
});
