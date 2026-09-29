// chenpilot/src/Agents/capability/__tests__/CapabilityAttenuation.test.ts
import { capabilityManager } from "../CapabilityManager";
import {
  AuthorityBroadeningError,
  ConfusedDeputyError,
  CrossPlanReplayError,
  CrossStepReplayError,
  ReplayAttackError,
  CapabilityExpiredError,
  CapabilityRevokedError,
  CapabilityTamperedError,
  AssetLimitExceededError,
} from "../CapabilityErrors";
import { BaseTool } from "../../tools/base/BaseTool";
import { ToolMetadata, ToolResult } from "../../registry/ToolMetadata";
import { toolRegistry } from "../../registry/ToolRegistry";
import { planExecutor } from "../../planner/PlanExecutor";
import { ExecutionPlan } from "../../planner/AgentPlanner";

// Mock Tool for testing capability integration
class MockTransferTool extends BaseTool {
  public executed = false;
  public executionCount = 0;

  metadata: ToolMetadata = {
    name: "mock_transfer_tool",
    description: "Mock transfer tool for capability tests",
    parameters: {
      to: { type: "string", description: "Recipient", required: true },
      amount: { type: "number", description: "Amount", required: true },
      asset: { type: "string", description: "Asset", required: true },
    },
    examples: [],
    category: "wallet",
    version: "1.0.0",
    riskLevel: "high",
    capabilities: ["transfer"],
  };

  async execute(payload: {
    to: string;
    amount: number;
    asset: string;
  }): Promise<ToolResult> {
    this.executed = true;
    this.executionCount++;
    return this.createSuccessResult(this.metadata.name, {
      transferred: true,
      amount: payload.amount,
      asset: payload.asset,
    });
  }

  reset(): void {
    this.executed = false;
    this.executionCount = 0;
  }
}

class MockPriceTool extends BaseTool {
  public executed = false;

  metadata: ToolMetadata = {
    name: "mock_price_tool",
    description: "Mock price tool for capability tests",
    parameters: {
      asset: { type: "string", description: "Asset code", required: true },
    },
    examples: [],
    category: "market",
    version: "1.0.0",
    riskLevel: "low",
    capabilities: ["market_data"],
  };

  async execute(payload: { asset: string }): Promise<ToolResult> {
    this.executed = true;
    return this.createSuccessResult(this.metadata.name, {
      asset: payload.asset,
      price: 1.25,
    });
  }

  reset(): void {
    this.executed = false;
  }
}

describe("Capability Attenuation System (Issue #633)", () => {
  const mockTransferTool = new MockTransferTool();
  const mockPriceTool = new MockPriceTool();

  beforeAll(() => {
    try {
      toolRegistry.register(mockTransferTool);
    } catch {
      // Already registered
    }
    try {
      toolRegistry.register(mockPriceTool);
    } catch {
      // Already registered
    }
  });

  beforeEach(() => {
    capabilityManager.reset();
    mockTransferTool.reset();
    mockPriceTool.reset();
  });

  describe("1. Grant Issuance and Cryptographic Integrity", () => {
    it("should issue a validly signed capability grant", () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_root_001",
        userId: "user_alice",
        network: "testnet",
        allowedActions: ["mock_price_tool", "mock_transfer_tool"],
        assetLimits: { USDC: 500, XLM: 1000 },
        maxCalls: 5,
        ttlMs: 60000,
      });

      expect(grant.grantId).toBeDefined();
      expect(grant.grantId.startsWith("cap_")).toBe(true);
      expect(grant.signature).toBeDefined();
      expect(grant.usedCalls).toBe(0);
      expect(grant.maxCalls).toBe(5);
      expect(grant.allowedActions).toContain("mock_transfer_tool");

      // Verify validation passes
      const validation = capabilityManager.validateGrant(grant, {
        planId: "plan_root_001",
        userId: "user_alice",
        network: "testnet",
        action: "mock_price_tool",
        payload: { asset: "USDC" },
      });
      expect(validation.valid).toBe(true);
    });

    it("should serialize and deserialize grant tokens losslessly", () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_root_002",
        userId: "user_bob",
        allowedActions: ["mock_price_tool"],
      });

      const token = capabilityManager.serializeGrant(grant);
      expect(typeof token).toBe("string");

      const deserialized = capabilityManager.deserializeGrant(token);
      expect(deserialized.grantId).toBe(grant.grantId);
      expect(deserialized.signature).toBe(grant.signature);

      const validation = capabilityManager.validateGrant(token, {
        planId: "plan_root_002",
        userId: "user_bob",
        action: "mock_price_tool",
      });
      expect(validation.valid).toBe(true);
    });

    it("should detect and reject tampered capability grants", async () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_root_003",
        userId: "user_alice",
        allowedActions: ["mock_price_tool"],
      });

      // Attacker tampers with the grant to add unauthorized action
      const tamperedGrant = {
        ...grant,
        allowedActions: ["mock_price_tool", "mock_transfer_tool"],
      };

      const validation = capabilityManager.validateGrant(tamperedGrant, {
        planId: "plan_root_003",
        userId: "user_alice",
        action: "mock_transfer_tool",
      });

      expect(validation.valid).toBe(false);
      expect(validation.errorCode).toBe("GRANT_SIGNATURE_INVALID");

      await expect(
        capabilityManager.consumeGrant(tamperedGrant, {
          planId: "plan_root_003",
          userId: "user_alice",
          action: "mock_transfer_tool",
        })
      ).rejects.toThrow(CapabilityTamperedError);
    });
  });

  describe("2. Capability Attenuation & Anti-Broadening Invariants", () => {
    it("should allow attenuating a parent grant to a strict subset of tools and asset caps", () => {
      const parentGrant = capabilityManager.issueGrant({
        planId: "plan_root_010",
        userId: "user_alice",
        network: "testnet",
        allowedActions: ["mock_price_tool", "mock_transfer_tool"],
        assetLimits: { USDC: 500, XLM: 1000 },
        maxCalls: 10,
        ttlMs: 60000,
      });

      // Child sub-plan delegated only price checks and up to 100 USDC
      const childGrant = capabilityManager.attenuateGrant({
        parentGrant,
        subPlanId: "subplan_child_010",
        stepNumber: 1,
        targetAgent: "price_specialist",
        allowedActions: ["mock_price_tool"],
        assetLimits: { USDC: 100 },
        maxCalls: 2,
      });

      expect(childGrant.parentId).toBe(parentGrant.grantId);
      expect(childGrant.planId).toBe(parentGrant.planId);
      expect(childGrant.subPlanId).toBe("subplan_child_010");
      expect(childGrant.allowedActions).toEqual(["mock_price_tool"]);
      expect(childGrant.assetLimits).toEqual({ USDC: 100 });
      expect(childGrant.maxCalls).toBe(2);

      const validation = capabilityManager.validateGrant(childGrant, {
        planId: "plan_root_010",
        subPlanId: "subplan_child_010",
        stepNumber: 1,
        userId: "user_alice",
        targetAgent: "price_specialist",
        action: "mock_price_tool",
      });
      expect(validation.valid).toBe(true);
    });

    it("should reject child grant attempting to add actions not in parent grant", () => {
      const parentGrant = capabilityManager.issueGrant({
        planId: "plan_root_011",
        userId: "user_alice",
        allowedActions: ["mock_price_tool"],
      });

      expect(() => {
        capabilityManager.attenuateGrant({
          parentGrant,
          allowedActions: ["mock_price_tool", "mock_transfer_tool"],
        });
      }).toThrow(AuthorityBroadeningError);
    });

    it("should reject child grant attempting to exceed parent asset limit", () => {
      const parentGrant = capabilityManager.issueGrant({
        planId: "plan_root_012",
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
        assetLimits: { USDC: 100 },
      });

      expect(() => {
        capabilityManager.attenuateGrant({
          parentGrant,
          assetLimits: { USDC: 200 },
        });
      }).toThrow(AuthorityBroadeningError);
    });

    it("should reject child grant attempting to add unauthorized asset codes", () => {
      const parentGrant = capabilityManager.issueGrant({
        planId: "plan_root_013",
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
        assetLimits: { USDC: 100 },
      });

      expect(() => {
        capabilityManager.attenuateGrant({
          parentGrant,
          assetLimits: { ETH: 5 },
        });
      }).toThrow(AuthorityBroadeningError);
    });

    it("should reject child grant attempting to broaden network scope", () => {
      const parentGrant = capabilityManager.issueGrant({
        planId: "plan_root_014",
        userId: "user_alice",
        network: "testnet",
        allowedActions: ["mock_price_tool"],
      });

      expect(() => {
        capabilityManager.attenuateGrant({
          parentGrant,
          network: "mainnet",
        });
      }).toThrow(AuthorityBroadeningError);

      expect(() => {
        capabilityManager.attenuateGrant({
          parentGrant,
          network: "all",
        });
      }).toThrow(AuthorityBroadeningError);
    });

    it("should clamp child grant expiry to parent grant expiry", () => {
      const parentGrant = capabilityManager.issueGrant({
        planId: "plan_root_015",
        userId: "user_alice",
        allowedActions: ["mock_price_tool"],
        ttlMs: 5000, // 5 seconds
      });

      // Child asks for 10 minutes
      const childGrant = capabilityManager.attenuateGrant({
        parentGrant,
        ttlMs: 600000,
      });

      // Child expiry must not exceed parent expiry
      expect(childGrant.expiresAt).toBeLessThanOrEqual(parentGrant.expiresAt);
    });
  });

  describe("3. Confused-Deputy Attack Defenses", () => {
    it("should reject specialist agent attempting to execute unauthorized tool", async () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_confused_001",
        userId: "user_victim",
        allowedActions: ["mock_price_tool"],
      });

      // Prompt injection attempts to force transfer
      const validation = capabilityManager.validateGrant(grant, {
        planId: "plan_confused_001",
        userId: "user_victim",
        action: "mock_transfer_tool",
        payload: { to: "attacker", amount: 1000, asset: "USDC" },
      });

      expect(validation.valid).toBe(false);
      expect(validation.errorCode).toBe("CONFUSED_DEPUTY");

      await expect(
        capabilityManager.consumeGrant(grant, {
          planId: "plan_confused_001",
          userId: "user_victim",
          action: "mock_transfer_tool",
          payload: { to: "attacker", amount: 1000, asset: "USDC" },
        })
      ).rejects.toThrow(ConfusedDeputyError);

      expect(mockTransferTool.executed).toBe(false);
    });

    it("should reject grant when user ID does not match execution context", async () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_confused_002",
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
      });

      // Attacker tries to execute using alice's grant under bob's context
      const validation = capabilityManager.validateGrant(grant, {
        planId: "plan_confused_002",
        userId: "user_bob",
        action: "mock_transfer_tool",
      });

      expect(validation.valid).toBe(false);
      expect(validation.errorCode).toBe("USER_MISMATCH");

      await expect(
        capabilityManager.consumeGrant(grant, {
          planId: "plan_confused_002",
          userId: "user_bob",
          action: "mock_transfer_tool",
        })
      ).rejects.toThrow(CapabilityTamperedError); // USER_MISMATCH maps to security failure
    });

    it("should reject grant when specialist agent identity does not match", async () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_confused_003",
        userId: "user_alice",
        targetAgent: "price_specialist",
        allowedActions: ["mock_price_tool"],
      });

      const validation = capabilityManager.validateGrant(grant, {
        planId: "plan_confused_003",
        userId: "user_alice",
        targetAgent: "untrusted_agent",
        action: "mock_price_tool",
      });

      expect(validation.valid).toBe(false);
      expect(validation.errorCode).toBe("CONFUSED_DEPUTY");
    });
  });

  describe("4. Cross-Plan and Cross-Step Replay Attacks", () => {
    it("should reject cross-plan replay attack (grant from Plan A used in Plan B)", async () => {
      const grantPlanA = capabilityManager.issueGrant({
        planId: "plan_A_100",
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
      });

      // Attempt to use grantPlanA in plan_B_200
      const validation = capabilityManager.validateGrant(grantPlanA, {
        planId: "plan_B_200",
        userId: "user_alice",
        action: "mock_transfer_tool",
      });

      expect(validation.valid).toBe(false);
      expect(validation.errorCode).toBe("PLAN_MISMATCH");

      await expect(
        capabilityManager.consumeGrant(grantPlanA, {
          planId: "plan_B_200",
          userId: "user_alice",
          action: "mock_transfer_tool",
        })
      ).rejects.toThrow(CrossPlanReplayError);
    });

    it("should reject cross-step replay attack (step 1 grant used in step 2)", async () => {
      const step1Grant = capabilityManager.issueGrant({
        planId: "plan_steps_001",
        stepNumber: 1,
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
      });

      // Attempt to use step1Grant in step 2
      const validation = capabilityManager.validateGrant(step1Grant, {
        planId: "plan_steps_001",
        stepNumber: 2,
        userId: "user_alice",
        action: "mock_transfer_tool",
      });

      expect(validation.valid).toBe(false);
      expect(validation.errorCode).toBe("STEP_MISMATCH");

      await expect(
        capabilityManager.consumeGrant(step1Grant, {
          planId: "plan_steps_001",
          stepNumber: 2,
          userId: "user_alice",
          action: "mock_transfer_tool",
        })
      ).rejects.toThrow(CrossStepReplayError);
    });
  });

  describe("5. Replay Resistance & Single-Use Enforcement", () => {
    it("should allow first use of single-use grant and reject second use (replay attack)", async () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_replay_001",
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
        maxCalls: 1,
      });

      // 1st consumption: Success
      const consumed = await capabilityManager.consumeGrant(grant, {
        planId: "plan_replay_001",
        userId: "user_alice",
        action: "mock_transfer_tool",
      });
      expect(consumed.usedCalls).toBe(1);

      // 2nd consumption: Replay attack detected
      const validation = capabilityManager.validateGrant(grant, {
        planId: "plan_replay_001",
        userId: "user_alice",
        action: "mock_transfer_tool",
      });
      expect(validation.valid).toBe(false);
      expect(validation.errorCode).toBe("REPLAY_DETECTED");

      await expect(
        capabilityManager.consumeGrant(grant, {
          planId: "plan_replay_001",
          userId: "user_alice",
          action: "mock_transfer_tool",
        })
      ).rejects.toThrow(ReplayAttackError);
    });
  });

  describe("6. Revocation and Expiration Lifecycle", () => {
    it("should immediately deny tool calls when grant is revoked", async () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_revocation_001",
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
      });

      // Revoke grant
      capabilityManager.revokeGrant(
        grant.grantId,
        "Suspicious activity detected"
      );
      expect(capabilityManager.isRevoked(grant.grantId)).toBe(true);

      const validation = capabilityManager.validateGrant(grant, {
        planId: "plan_revocation_001",
        userId: "user_alice",
        action: "mock_transfer_tool",
      });
      expect(validation.valid).toBe(false);
      expect(validation.errorCode).toBe("GRANT_REVOKED");

      await expect(
        capabilityManager.consumeGrant(grant, {
          planId: "plan_revocation_001",
          userId: "user_alice",
          action: "mock_transfer_tool",
        })
      ).rejects.toThrow(CapabilityRevokedError);
    });

    it("should revoke all child grants when parent plan is revoked", async () => {
      const grant1 = capabilityManager.issueGrant({
        planId: "plan_revocation_all_001",
        userId: "user_alice",
        allowedActions: ["mock_price_tool"],
      });
      const grant2 = capabilityManager.issueGrant({
        planId: "plan_revocation_all_001",
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
      });

      // Revoke entire plan
      capabilityManager.revokePlanGrants(
        "plan_revocation_all_001",
        "Plan aborted by user"
      );

      expect(
        capabilityManager.isRevoked(grant1.grantId, "plan_revocation_all_001")
      ).toBe(true);
      expect(
        capabilityManager.isRevoked(grant2.grantId, "plan_revocation_all_001")
      ).toBe(true);

      await expect(
        capabilityManager.consumeGrant(grant1, {
          planId: "plan_revocation_all_001",
          userId: "user_alice",
          action: "mock_price_tool",
        })
      ).rejects.toThrow(CapabilityRevokedError);
    });

    it("should reject expired grants", async () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_expire_001",
        userId: "user_alice",
        allowedActions: ["mock_price_tool"],
        ttlMs: -1000, // Expired in the past
      });

      const validation = capabilityManager.validateGrant(grant, {
        planId: "plan_expire_001",
        userId: "user_alice",
        action: "mock_price_tool",
      });

      expect(validation.valid).toBe(false);
      expect(validation.errorCode).toBe("GRANT_EXPIRED");

      await expect(
        capabilityManager.consumeGrant(grant, {
          planId: "plan_expire_001",
          userId: "user_alice",
          action: "mock_price_tool",
        })
      ).rejects.toThrow(CapabilityExpiredError);
    });
  });

  describe("7. Asset Limits Enforcement", () => {
    it("should enforce asset spending limits and reject excessive requests", async () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_limits_001",
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
        assetLimits: { USDC: 50 },
      });

      // 1. Under limit (30 USDC) -> valid
      const validCheck = capabilityManager.validateGrant(grant, {
        planId: "plan_limits_001",
        userId: "user_alice",
        action: "mock_transfer_tool",
        payload: { to: "bob", amount: 30, asset: "USDC" },
      });
      expect(validCheck.valid).toBe(true);

      // 2. Over limit (100 USDC) -> rejected
      const invalidCheck = capabilityManager.validateGrant(grant, {
        planId: "plan_limits_001",
        userId: "user_alice",
        action: "mock_transfer_tool",
        payload: { to: "bob", amount: 100, asset: "USDC" },
      });
      expect(invalidCheck.valid).toBe(false);
      expect(invalidCheck.errorCode).toBe("ASSET_LIMIT_EXCEEDED");

      await expect(
        capabilityManager.consumeGrant(grant, {
          planId: "plan_limits_001",
          userId: "user_alice",
          action: "mock_transfer_tool",
          payload: { to: "bob", amount: 100, asset: "USDC" },
        })
      ).rejects.toThrow(AssetLimitExceededError);
    });
  });

  describe("8. Tool-Level Gating & Side-Effect Prevention", () => {
    it("should execute tool through registry with valid capability grant", async () => {
      const grant = capabilityManager.issueGrant({
        planId: "plan_registry_001",
        userId: "user_alice",
        allowedActions: ["mock_transfer_tool"],
      });

      const result = await toolRegistry.executeTool(
        "mock_transfer_tool",
        { to: "bob", amount: 25, asset: "USDC" },
        "user_alice",
        {
          grant,
          context: { planId: "plan_registry_001" },
        }
      );

      expect(result.status).toBe("success");
      expect(mockTransferTool.executed).toBe(true);
      expect(mockTransferTool.executionCount).toBe(1);
    });

    it("should fail tool execution before calling execute() when grant is missing and required", async () => {
      await expect(
        toolRegistry.executeTool(
          "mock_transfer_tool",
          { to: "attacker", amount: 999, asset: "USDC" },
          "user_alice",
          {
            requireGrant: true,
          }
        )
      ).rejects.toThrow();

      // Tool business logic was NOT executed
      expect(mockTransferTool.executed).toBe(false);
      expect(mockTransferTool.executionCount).toBe(0);
    });
  });

  describe("9. End-to-End Sub-Plan Delegation in PlanExecutor", () => {
    it("should execute delegated sub-plan within attenuated capabilities", async () => {
      const parentGrant = capabilityManager.issueGrant({
        planId: "plan_main_001",
        userId: "user_alice",
        allowedActions: ["mock_price_tool", "mock_transfer_tool"],
        assetLimits: { USDC: 500 },
        maxCalls: 5,
      });

      const subPlan: ExecutionPlan = {
        planId: "subplan_price_001",
        parentPlanId: "plan_main_001",
        steps: [
          {
            stepNumber: 1,
            action: "mock_price_tool",
            payload: { asset: "USDC" },
            description: "Check USDC price",
          },
        ],
        totalSteps: 1,
        estimatedDuration: 1000,
        riskLevel: "low",
        requiresApproval: false,
        summary: "Sub-plan for price check",
      };

      const result = await planExecutor.executeSubPlan(
        subPlan,
        parentGrant,
        "user_alice"
      );

      expect(result.status).toBe("success");
      expect(result.completedSteps).toBe(1);
      expect(mockPriceTool.executed).toBe(true);
    });

    it("should block delegated sub-plan when it attempts unauthorized action outside grant", async () => {
      // Malicious or misconfigured sub-plan attempts transfer
      const subPlan: ExecutionPlan = {
        planId: "subplan_malicious_002",
        parentPlanId: "plan_main_002",
        steps: [
          {
            stepNumber: 1,
            action: "mock_transfer_tool",
            payload: { to: "attacker", amount: 100, asset: "USDC" },
            description: "Unauthorized transfer in child plan",
          },
        ],
        totalSteps: 1,
        estimatedDuration: 1000,
        riskLevel: "high",
        requiresApproval: false,
        summary: "Malicious sub-plan",
      };

      // Attenuating for subplan_malicious_002 fails because parent does not allow mock_transfer_tool
      const parent = capabilityManager.issueGrant({
        planId: "plan_main_002",
        userId: "user_alice",
        allowedActions: ["mock_price_tool"],
      });

      const result = await planExecutor.executeSubPlan(
        subPlan,
        parent,
        "user_alice"
      );

      expect(result.status).toBe("failed");
      expect(mockTransferTool.executed).toBe(false);
    });
  });
});
