"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.planVerifier = exports.PlanVerifier = void 0;
exports.verifyExecutionPlan = verifyExecutionPlan;
const crypto_1 = __importDefault(require("crypto"));
/**
 * SDK-side plan verification to prevent backend tampering.
 * Ensures the execution plan matches the original hash and signature.
 */
class PlanVerifier {
  constructor() {
    this.HASH_VERSION = "1.0.0";
    this.HASH_ALGORITHM = "sha256";
  }
  /**
   * Verifies the execution plan integrity before execution.
   * Main entry point for SDK verification.
   *
   * @param plan - The execution plan to verify.
   * @param options - Custom verification options.
   * @returns Verification result including boolean validity and error messages.
   */
  verifyPlan(plan, options = {}) {
    const errors = [];
    const warnings = [];
    let hashMatch = false;
    let signatureValid = false;
    // 1. Check if plan has a hash
    if (!plan.planHash) {
      errors.push("Plan is missing required hash field");
      return {
        valid: false,
        errors,
        warnings,
        hashMatch: false,
        signatureValid: false,
      };
    }
    // 2. Verify hash matches plan content
    const computedHash = this.computePlanHash(plan);
    hashMatch = computedHash === plan.planHash;
    if (!hashMatch) {
      errors.push(
        `Plan hash mismatch! Expected: ${plan.planHash}, Got: ${computedHash}`
      );
      errors.push("CRITICAL: Plan may have been tampered with!");
    }
    // 3. Verify signature if required or present
    if (options.requireSignature || plan.signature) {
      if (!plan.signature) {
        errors.push("Signature required but not present in plan");
      } else if (!options.publicKey) {
        warnings.push(
          "Signature present but no public key provided for verification"
        );
      } else {
        signatureValid = this.verifySignature(
          plan.planHash,
          plan.signature,
          options.publicKey
        );
        if (!signatureValid) {
          errors.push("Invalid signature! Plan signature verification failed.");
        }
      }
    }
    // 4. Additional validations in strict mode
    if (options.strictMode) {
      this.performStrictValidations(plan, errors, warnings);
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      hashMatch,
      signatureValid: options.publicKey ? signatureValid : true,
    };
  }
  /**
   * Compute deterministic hash for the plan
   * Must match backend hash generation algorithm
   */
  computePlanHash(plan) {
    const canonical = this.canonicalizePlan(plan);
    return crypto_1.default
      .createHash(this.HASH_ALGORITHM)
      .update(canonical)
      .digest("hex");
  }
  /**
   * Create canonical representation of plan for hashing
   */
  canonicalizePlan(plan) {
    const canonical = {
      version: this.HASH_VERSION,
      planId: plan.planId,
      steps: plan.steps.map((step) => this.canonicalizeStep(step)),
      totalSteps: plan.totalSteps,
      riskLevel: plan.riskLevel,
      summary: plan.summary,
    };
    return JSON.stringify(canonical, Object.keys(canonical).sort());
  }
  /**
   * Canonicalize a single step
   */
  canonicalizeStep(step) {
    return {
      stepNumber: step.stepNumber,
      action: step.action,
      payload: this.sortObject(step.payload),
      description: step.description,
      dependencies: step.dependencies || [],
    };
  }
  /**
   * Sort object keys recursively for deterministic serialization
   */
  sortObject(obj) {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) =>
        typeof item === "object" && item !== null ? this.sortObject(item) : item
      );
    }
    const sorted = {};
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        const value = obj[key];
        sorted[key] =
          typeof value === "object" && value !== null
            ? this.sortObject(value)
            : value;
      });
    return sorted;
  }
  /**
   * Verify signature using public key
   */
  verifySignature(planHash, signature, publicKey) {
    try {
      const verify = crypto_1.default.createVerify("RSA-SHA256");
      verify.update(planHash);
      verify.end();
      return verify.verify(publicKey, signature, "base64");
    } catch (_a) {
      return false;
    }
  }
  /**
   * Perform additional strict validations
   */
  performStrictValidations(plan, errors, warnings) {
    // Check for suspicious patterns
    if (plan.steps.length === 0) {
      errors.push("Plan has no steps");
    }
    if (plan.steps.length > 50) {
      warnings.push("Plan has unusually high number of steps (>50)");
    }
    // Check for duplicate step numbers
    const stepNumbers = plan.steps.map((s) => s.stepNumber);
    const duplicates = stepNumbers.filter(
      (num, idx) => stepNumbers.indexOf(num) !== idx
    );
    if (duplicates.length > 0) {
      errors.push(`Duplicate step numbers detected: ${duplicates.join(", ")}`);
    }
    // Check for missing step numbers
    for (let i = 1; i <= plan.totalSteps; i++) {
      if (!stepNumbers.includes(i)) {
        errors.push(`Missing step number: ${i}`);
      }
    }
    // Validate step count matches
    if (plan.steps.length !== plan.totalSteps) {
      errors.push(
        `Step count mismatch: steps.length=${plan.steps.length}, totalSteps=${plan.totalSteps}`
      );
    }
    // Check for suspicious actions (potential injection)
    const suspiciousPatterns = [
      "transfer.*wallet",
      "send.*dev",
      "hidden",
      "secret",
      "backdoor",
    ];
    plan.steps.forEach((step) => {
      const stepStr = JSON.stringify(step).toLowerCase();
      suspiciousPatterns.forEach((pattern) => {
        if (new RegExp(pattern, "i").test(stepStr)) {
          warnings.push(
            `Potentially suspicious pattern detected in step ${step.stepNumber}: ${pattern}`
          );
        }
      });
    });
  }
  /**
   * Compares two plans to detect any modifications.
   *
   * @param originalPlan - The originally created plan.
   * @param currentPlan - The plan to verify against the original.
   * @returns The difference report indicating if they are identical.
   */
  comparePlans(originalPlan, currentPlan) {
    const differences = [];
    if (originalPlan.planId !== currentPlan.planId) {
      differences.push("Plan ID changed");
    }
    if (originalPlan.totalSteps !== currentPlan.totalSteps) {
      differences.push(
        `Total steps changed: ${originalPlan.totalSteps} -> ${currentPlan.totalSteps}`
      );
    }
    if (originalPlan.steps.length !== currentPlan.steps.length) {
      differences.push(
        `Step count changed: ${originalPlan.steps.length} -> ${currentPlan.steps.length}`
      );
    }
    // Compare each step
    for (
      let i = 0;
      i < Math.max(originalPlan.steps.length, currentPlan.steps.length);
      i++
    ) {
      const origStep = originalPlan.steps[i];
      const currStep = currentPlan.steps[i];
      if (!origStep) {
        differences.push(`New step added at position ${i + 1}`);
        continue;
      }
      if (!currStep) {
        differences.push(`Step removed at position ${i + 1}`);
        continue;
      }
      if (origStep.action !== currStep.action) {
        differences.push(
          `Step ${i + 1} action changed: ${origStep.action} -> ${currStep.action}`
        );
      }
      if (
        JSON.stringify(origStep.payload) !== JSON.stringify(currStep.payload)
      ) {
        differences.push(`Step ${i + 1} payload modified`);
      }
    }
    return {
      identical: differences.length === 0,
      differences,
    };
  }
}
exports.PlanVerifier = PlanVerifier;
exports.planVerifier = new PlanVerifier();
/**
 * Convenience function for quick plan verification.
 *
 * @param plan - The execution plan to verify.
 * @param options - Custom verification options.
 * @returns Verification result including boolean validity and error messages.
 */
function verifyExecutionPlan(plan, options) {
  return exports.planVerifier.verifyPlan(plan, options);
}
