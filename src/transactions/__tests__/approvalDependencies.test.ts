import {
  ApprovalDependencies,
  DEPENDENCY_NAMES,
  ReapprovalRequiredError,
  approvalDigest,
  checkApproval,
  createApproval,
  submitWithApproval,
} from "../approvalDependencies";

const deps: ApprovalDependencies = {
  assetMetadataVersion: "a1",
  issuerStatusVersion: "i1",
  routeVersion: "r1",
  feePolicyVersion: "f1",
  contractVersion: "c1",
};
const payload = { from: "GA...", to: "GB...", amount: "10.0000000", asset: "USDC" };

describe("approval dependencies", () => {
  it("binds every dependency version into the digest", () => {
    const base = approvalDigest(payload, deps);
    for (const name of DEPENDENCY_NAMES) {
      expect(approvalDigest(payload, { ...deps, [name]: "changed" })).not.toBe(base);
    }
  });

  it("is independent of key order", () => {
    const reordered = Object.fromEntries(Object.entries(deps).reverse()) as unknown as ApprovalDependencies;
    expect(approvalDigest(payload, reordered)).toBe(approvalDigest(payload, deps));
  });

  it("stays valid when nothing changed", () => {
    expect(checkApproval(createApproval(payload, deps), payload, { ...deps })).toEqual({ valid: true });
  });

  it.each(DEPENDENCY_NAMES)("invalidates with a precise reason when %s changes", (name) => {
    const approval = createApproval(payload, deps);
    const check = checkApproval(approval, payload, { ...deps, [name]: "v2" });
    expect(check.valid).toBe(false);
    if (!check.valid) {
      expect(check.changed).toEqual([name]);
      expect(check.reasons).toHaveLength(1);
    }
  });

  it("invalidates when the payload itself changes", () => {
    const check = checkApproval(createApproval(payload, deps), { ...payload, amount: "11" }, deps);
    expect(check.valid).toBe(false);
  });

  it("is not affected by mutating the caller's dependency object after approval", () => {
    const input = { ...deps };
    const approval = createApproval(payload, input);
    input.routeVersion = "r2";
    expect(checkApproval(approval, payload, deps)).toEqual({ valid: true });
  });

  describe("submitWithApproval", () => {
    it("submits when dependencies are unchanged", async () => {
      const submit = jest.fn(async () => "tx-hash");
      await expect(submitWithApproval(createApproval(payload, deps), payload, async () => deps, submit)).resolves.toBe("tx-hash");
      expect(submit).toHaveBeenCalledTimes(1);
    });

    it("blocks a change that races between approval and submission", async () => {
      const approval = createApproval(payload, deps);
      let current = { ...deps };
      // Fee policy revised after approval but before submission.
      setImmediate(() => (current = { ...current, feePolicyVersion: "f2" }));
      await new Promise((r) => setImmediate(r));

      const submit = jest.fn();
      const promise = submitWithApproval(approval, payload, async () => current, submit);
      await expect(promise).rejects.toBeInstanceOf(ReapprovalRequiredError);
      await expect(promise).rejects.toThrow(/Fees changed/);
      expect(submit).not.toHaveBeenCalled();
    });
  });
});
