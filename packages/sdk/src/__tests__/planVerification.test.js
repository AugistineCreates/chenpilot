"use strict";
/**
 * Unit tests for Plan Verification
 * Tests hash computation, signature verification, and plan integrity checks
 */
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const planVerification_1 = require("../planVerification");
const crypto_1 = __importDefault(require("crypto"));
describe("PlanVerifier", () => {
  let verifier;
  let validPlan;
  beforeEach(() => {
    verifier = new planVerification_1.PlanVerifier();
    validPlan = {
      planId: "plan_123",
      steps: [
        {
          stepNumber: 1,
          action: "swap",
          payload: { from: "BTC", to: "XLM", amount: "1000" },
          description: "Swap BTC to XLM",
          dependencies: [],
        },
        {
          stepNumber: 2,
          action: "transfer",
          payload: { to: "GADDR", amount: "1000" },
          description: "Transfer XLM",
          dependencies: [1],
        },
      ],
      totalSteps: 2,
      estimatedDuration: 5000,
      riskLevel: "low",
      requiresApproval: false,
      summary: "Swap and transfer",
    };
  });
  describe("Basic Validation", () => {
    it("should fail when plan has no hash", () => {
      const result = verifier.verifyPlan(validPlan);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Plan is missing required hash field");
      expect(result.hashMatch).toBe(false);
    });
    it("should succeed with valid hash", () => {
      const hash = computeTestHash(validPlan);
      const planWithHash = Object.assign(Object.assign({}, validPlan), {
        planHash: hash,
      });
      const result = verifier.verifyPlan(planWithHash);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.hashMatch).toBe(true);
    });
    it("should detect hash mismatch", () => {
      const planWithHash = Object.assign(Object.assign({}, validPlan), {
        planHash: "invalid_hash",
      });
      const result = verifier.verifyPlan(planWithHash);
      expect(result.valid).toBe(false);
      expect(result.hashMatch).toBe(false);
      expect(result.errors.some((e) => e.includes("Plan hash mismatch"))).toBe(
        true
      );
      expect(result.errors.some((e) => e.includes("CRITICAL"))).toBe(true);
    });
  });
  describe("Signature Verification", () => {
    let publicKey;
    let privateKey;
    beforeEach(() => {
      const { publicKey: pub, privateKey: priv } =
        crypto_1.default.generateKeyPairSync("rsa", {
          modulusLength: 2048,
          publicKeyEncoding: { type: "spki", format: "pem" },
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
        });
      publicKey = pub;
      privateKey = priv;
    });
    it("should fail when signature required but not present", () => {
      const hash = computeTestHash(validPlan);
      const planWithHash = Object.assign(Object.assign({}, validPlan), {
        planHash: hash,
      });
      const result = verifier.verifyPlan(planWithHash, {
        requireSignature: true,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Signature required but not present in plan"
      );
    });
    it("should warn when signature present but no public key", () => {
      const hash = computeTestHash(validPlan);
      const signature = signHash(hash, privateKey);
      const planWithHashAndSig = Object.assign(Object.assign({}, validPlan), {
        planHash: hash,
        signature,
      });
      const result = verifier.verifyPlan(planWithHashAndSig);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        "Signature present but no public key provided for verification"
      );
    });
    it("should verify valid signature", () => {
      const hash = computeTestHash(validPlan);
      const signature = signHash(hash, privateKey);
      const planWithHashAndSig = Object.assign(Object.assign({}, validPlan), {
        planHash: hash,
        signature,
      });
      const result = verifier.verifyPlan(planWithHashAndSig, { publicKey });
      expect(result.valid).toBe(true);
      expect(result.signatureValid).toBe(true);
    });
    it("should detect invalid signature", () => {
      const hash = computeTestHash(validPlan);
      const planWithHashAndSig = Object.assign(Object.assign({}, validPlan), {
        planHash: hash,
        signature: "invalid_signature",
      });
      const result = verifier.verifyPlan(planWithHashAndSig, { publicKey });
      expect(result.valid).toBe(false);
      expect(result.signatureValid).toBe(false);
    });
  });
  describe("Strict Mode Validations", () => {
    it("should fail for plan with no steps", () => {
      const emptyPlan = Object.assign(Object.assign({}, validPlan), {
        steps: [],
        totalSteps: 0,
      });
      const hash = computeTestHash(emptyPlan);
      const planWithHash = Object.assign(Object.assign({}, emptyPlan), {
        planHash: hash,
      });
      const result = verifier.verifyPlan(planWithHash, { strictMode: true });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Plan has no steps");
    });
    it("should warn for plan with many steps", () => {
      const manySteps = Array.from({ length: 60 }, (_, i) => ({
        stepNumber: i + 1,
        action: "action",
        payload: {},
        description: `Step ${i + 1}`,
      }));
      const largePlan = Object.assign(Object.assign({}, validPlan), {
        steps: manySteps,
        totalSteps: 60,
      });
      const hash = computeTestHash(largePlan);
      const planWithHash = Object.assign(Object.assign({}, largePlan), {
        planHash: hash,
      });
      const result = verifier.verifyPlan(planWithHash, { strictMode: true });
      expect(result.warnings).toContain(
        "Plan has unusually high number of steps (>50)"
      );
    });
    it("should detect duplicate step numbers", () => {
      const duplicatePlan = Object.assign(Object.assign({}, validPlan), {
        steps: [
          {
            stepNumber: 1,
            action: "action1",
            payload: {},
            description: "Step 1",
          },
          {
            stepNumber: 1,
            action: "action2",
            payload: {},
            description: "Step 1 dup",
          },
        ],
        totalSteps: 2,
      });
      const hash = computeTestHash(duplicatePlan);
      const planWithHash = Object.assign(Object.assign({}, duplicatePlan), {
        planHash: hash,
      });
      const result = verifier.verifyPlan(planWithHash, { strictMode: true });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("Duplicate step numbers"))
      ).toBe(true);
    });
    it("should detect missing step numbers", () => {
      const gappedPlan = Object.assign(Object.assign({}, validPlan), {
        steps: [
          {
            stepNumber: 1,
            action: "action1",
            payload: {},
            description: "Step 1",
          },
          {
            stepNumber: 3,
            action: "action3",
            payload: {},
            description: "Step 3",
          },
        ],
        totalSteps: 3,
      });
      const hash = computeTestHash(gappedPlan);
      const planWithHash = Object.assign(Object.assign({}, gappedPlan), {
        planHash: hash,
      });
      const result = verifier.verifyPlan(planWithHash, { strictMode: true });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing step number: 2");
    });
    it("should detect step count mismatch", () => {
      const mismatchPlan = Object.assign(Object.assign({}, validPlan), {
        steps: [
          {
            stepNumber: 1,
            action: "action1",
            payload: {},
            description: "Step 1",
          },
        ],
        totalSteps: 3,
      });
      const hash = computeTestHash(mismatchPlan);
      const planWithHash = Object.assign(Object.assign({}, mismatchPlan), {
        planHash: hash,
      });
      const result = verifier.verifyPlan(planWithHash, { strictMode: true });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Step count mismatch"))).toBe(
        true
      );
    });
    it("should detect suspicious patterns", () => {
      const suspiciousPlan = Object.assign(Object.assign({}, validPlan), {
        steps: [
          {
            stepNumber: 1,
            action: "transfer_to_dev_wallet",
            payload: { secret: "hidden" },
            description: "Backdoor",
          },
        ],
        totalSteps: 1,
      });
      const hash = computeTestHash(suspiciousPlan);
      const planWithHash = Object.assign(Object.assign({}, suspiciousPlan), {
        planHash: hash,
      });
      const result = verifier.verifyPlan(planWithHash, { strictMode: true });
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
  describe("Plan Comparison", () => {
    it("should detect identical plans", () => {
      const result = verifier.comparePlans(validPlan, validPlan);
      expect(result.identical).toBe(true);
      expect(result.differences).toHaveLength(0);
    });
    it("should detect plan ID change", () => {
      const modifiedPlan = Object.assign(Object.assign({}, validPlan), {
        planId: "plan_456",
      });
      const result = verifier.comparePlans(validPlan, modifiedPlan);
      expect(result.identical).toBe(false);
      expect(result.differences).toContain("Plan ID changed");
    });
    it("should detect action change", () => {
      const modifiedPlan = Object.assign(Object.assign({}, validPlan), {
        steps: [
          Object.assign(Object.assign({}, validPlan.steps[0]), {
            action: "different_action",
          }),
          validPlan.steps[1],
        ],
      });
      const result = verifier.comparePlans(validPlan, modifiedPlan);
      expect(result.identical).toBe(false);
      expect(result.differences.some((d) => d.includes("action changed"))).toBe(
        true
      );
    });
    it("should detect payload modification", () => {
      const modifiedPlan = Object.assign(Object.assign({}, validPlan), {
        steps: [
          Object.assign(Object.assign({}, validPlan.steps[0]), {
            payload: Object.assign(
              Object.assign({}, validPlan.steps[0].payload),
              { extra: "field" }
            ),
          }),
          validPlan.steps[1],
        ],
      });
      const result = verifier.comparePlans(validPlan, modifiedPlan);
      expect(result.identical).toBe(false);
      expect(
        result.differences.some((d) => d.includes("payload modified"))
      ).toBe(true);
    });
  });
  describe("Hash Determinism", () => {
    it("should produce same hash for same plan", () => {
      const hash1 = computeTestHash(validPlan);
      const hash2 = computeTestHash(validPlan);
      expect(hash1).toBe(hash2);
    });
    it("should produce different hash for different plans", () => {
      const plan2 = Object.assign(Object.assign({}, validPlan), {
        planId: "different_id",
      });
      const hash1 = computeTestHash(validPlan);
      const hash2 = computeTestHash(plan2);
      expect(hash1).not.toBe(hash2);
    });
    it("should be order-independent for object keys", () => {
      const plan1 = Object.assign(Object.assign({}, validPlan), {
        steps: [
          {
            stepNumber: 1,
            action: "swap",
            payload: { a: 1, b: 2, c: 3 },
            description: "Test",
          },
        ],
      });
      const plan2 = Object.assign(Object.assign({}, validPlan), {
        steps: [
          {
            stepNumber: 1,
            action: "swap",
            payload: { c: 3, a: 1, b: 2 },
            description: "Test",
          },
        ],
      });
      const hash1 = computeTestHash(plan1);
      const hash2 = computeTestHash(plan2);
      expect(hash1).toBe(hash2);
    });
  });
});
describe("Convenience Functions", () => {
  it("should use planVerifier singleton", () => {
    expect(planVerification_1.planVerifier).toBeInstanceOf(
      planVerification_1.PlanVerifier
    );
  });
  it("should verify plan using convenience function", () => {
    const plan = {
      planId: "test",
      steps: [],
      totalSteps: 0,
      estimatedDuration: 0,
      riskLevel: "low",
      requiresApproval: false,
      summary: "Test",
    };
    const result = (0, planVerification_1.verifyExecutionPlan)(plan);
    expect(result).toBeDefined();
    expect(result.valid).toBe(false);
  });
});
// Helper functions
function computeTestHash(plan) {
  const canonical = {
    version: "1.0.0",
    planId: plan.planId,
    steps: plan.steps.map((step) => ({
      stepNumber: step.stepNumber,
      action: step.action,
      payload: sortObject(step.payload),
      description: step.description,
      dependencies: step.dependencies || [],
    })),
    totalSteps: plan.totalSteps,
    riskLevel: plan.riskLevel,
    summary: plan.summary,
  };
  return crypto_1.default
    .createHash("sha256")
    .update(JSON.stringify(canonical, Object.keys(canonical).sort()))
    .digest("hex");
}
function sortObject(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === "object" && item !== null ? sortObject(item) : item
    );
  }
  const sorted = {};
  Object.keys(obj)
    .sort()
    .forEach((key) => {
      const value = obj[key];
      sorted[key] =
        typeof value === "object" && value !== null ? sortObject(value) : value;
    });
  return sorted;
}
function signHash(hash, privateKey) {
  const sign = crypto_1.default.createSign("RSA-SHA256");
  sign.update(hash);
  sign.end();
  return sign.sign(privateKey, "base64");
}
