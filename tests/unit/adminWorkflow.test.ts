import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("../../src/config/logger");
jest.mock("../../src/config/config", () => ({
  default: {
    agent: { timeouts: { toolExecution: 30000, agentExecution: 60000 } },
    jwt: { secret: "test-secret-32-chars-long-enough!!" },
  },
}));

jest.mock("../../src/config/Datasource", () => {
  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockReturnThis(),
  };

  const mockRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    create: jest.fn((data: unknown) => ({
      ...(data as Record<string, unknown>),
      id: "uuid-" + Math.random().toString(36).slice(2),
    })),
    save: jest.fn(async (entity: unknown) => entity),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockedAppDataSource = { getRepository: jest.fn(() => mockRepo) };

  return {
    __esModule: true,
    AppDataSource: mockedAppDataSource,
    default: mockedAppDataSource,
  };
});

jest.mock("../../src/AuditLog/auditLog.service", () => ({
  auditLogService: {
    logEvent: jest.fn().mockResolvedValue({ id: "audit-1" }),
  },
}));

jest.mock("../../src/Agents/registry/ToolRegistry", () => ({
  toolRegistry: {
    getTool: jest.fn(),
  },
}));

jest.mock("../../src/Agents/registry/PromptRolloutService", () => ({
  promptRolloutService: {
    activateWithPolicy: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../src/Auth/roles", () => ({
  UserRole: {
    ADMIN: "admin",
    MODERATOR: "moderator",
    USER: "user",
  },
  hasRequiredRole: jest.fn(() => true),
}));

import { AppDataSource } from "../../src/config/Datasource";
import { AdminWorkflowService } from "../../src/Agents/admin/workflow.service";
import {
  SensitiveActionType,
  WorkflowStatus,
  RiskLevel,
} from "../../src/Agents/admin/workflow.types";

describe("AdminWorkflowService", () => {
  let service: AdminWorkflowService;

  beforeEach(() => {
    service = new AdminWorkflowService();
    jest.clearAllMocks();
  });

  describe("getPolicy", () => {
    it("should return null when no policy exists", async () => {
      AppDataSource.getRepository().findOne.mockResolvedValue(null);

      const result = await service.getPolicy(SensitiveActionType.ENABLE_TOOL);
      expect(result).toBeNull();
    });
  });

  describe("initiateWorkflow", () => {
    it("should throw when no policy exists for the action type", async () => {
      AppDataSource.getRepository().findOne.mockResolvedValue(null);

      await expect(
        service.initiateWorkflow({
          actionType: SensitiveActionType.ENABLE_TOOL,
          initiatorId: "user-1",
          payload: {},
        })
      ).rejects.toThrow("No enabled workflow policy found");
    });

    it("should create a workflow instance when policy exists", async () => {
      const mockRepo = AppDataSource.getRepository();

      const mockPolicy = {
        id: "policy-1",
        actionType: SensitiveActionType.ENABLE_TOOL,
        name: "Enable Tool",
        requiredApprovals: 1,
        approvalTimeoutMinutes: 60,
        autoExecuteOnApproval: true,
        enabled: true,
        toInterface: () => ({}),
      };

      mockRepo.findOne.mockResolvedValue(mockPolicy);
      mockRepo.create.mockReturnValue({
        id: "instance-1",
        status: WorkflowStatus.PENDING,
      });
      mockRepo.save.mockResolvedValue({
        id: "instance-1",
        status: WorkflowStatus.PENDING,
      });

      const result = await service.initiateWorkflow({
        actionType: SensitiveActionType.ENABLE_TOOL,
        initiatorId: "user-1",
        payload: { toolName: "stellar_swap" },
      });

      expect(result.id).toBe("instance-1");
      expect(result.status).toBe(WorkflowStatus.PENDING);
    });
  });

  describe("approveInstance", () => {
    it("should throw when instance not found", async () => {
      AppDataSource.getRepository().findOne.mockResolvedValue(null);

      await expect(
        service.approveInstance("bad-id", "approver-1")
      ).rejects.toThrow("Workflow instance not found");
    });

    it("should throw when instance is not pending", async () => {
      const mockRepo = AppDataSource.getRepository();

      mockRepo.findOne.mockResolvedValue({
        id: "instance-1",
        status: WorkflowStatus.COMPLETED,
      });

      await expect(
        service.approveInstance("instance-1", "approver-1")
      ).rejects.toThrow("not pending");
    });

    it("should reject when instance has expired", async () => {
      const mockRepo = AppDataSource.getRepository();

      mockRepo.findOne.mockResolvedValue({
        id: "instance-1",
        status: WorkflowStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.approveInstance("instance-1", "approver-1")
      ).rejects.toThrow("expired");
    });
  });

  describe("rejectInstance", () => {
    it("should reject a pending workflow instance", async () => {
      const mockRepo = AppDataSource.getRepository();

      mockRepo.findOne.mockResolvedValue({
        id: "instance-1",
        status: WorkflowStatus.PENDING,
      });
      mockRepo.count.mockResolvedValue(0);
      mockRepo.create.mockReturnValue({ id: "approval-1" });

      const result = await service.rejectInstance(
        "instance-1",
        "approver-1",
        "Not safe"
      );

      expect(result.action).toBe("rejected");
      expect(result.instance.status).toBe(WorkflowStatus.REJECTED);
    });
  });

  describe("cancelWorkflow", () => {
    it("should cancel a pending workflow", async () => {
      const mockRepo = AppDataSource.getRepository();

      mockRepo.findOne.mockResolvedValue({
        id: "instance-1",
        status: WorkflowStatus.PENDING,
        initiatorId: "user-1",
        policyId: "policy-1",
      });

      const result = await service.cancelWorkflow("instance-1", "user-1");

      expect(result.status).toBe(WorkflowStatus.CANCELLED);
    });

    it("should throw when cancelling a completed workflow", async () => {
      AppDataSource.getRepository().findOne.mockResolvedValue({
        id: "instance-1",
        status: WorkflowStatus.COMPLETED,
      });

      await expect(
        service.cancelWorkflow("instance-1", "user-1")
      ).rejects.toThrow("Cannot cancel workflow in status: completed");
    });
  });

  describe("getInstances", () => {
    it("should return instances with pagination", async () => {
      const mockRepo = AppDataSource.getRepository();

      mockRepo.createQueryBuilder().getCount.mockResolvedValue(2);
      mockRepo.createQueryBuilder().getMany.mockResolvedValue([
        { id: "instance-1", status: WorkflowStatus.PENDING },
        { id: "instance-2", status: WorkflowStatus.PENDING },
      ]);

      const result = await service.getInstances({
        status: WorkflowStatus.PENDING,
        limit: 10,
        offset: 0,
      });

      expect(result.total).toBe(2);
      expect(result.instances.length).toBe(2);
    });
  });

  describe("getPendingApprovals", () => {
    it("should return pending instances for the approver", async () => {
      const mockRepo = AppDataSource.getRepository();

      mockRepo.find.mockResolvedValue([
        {
          instanceId: "instance-1",
          approverId: "approver-1",
          decision: "pending",
        },
      ]);
      mockRepo
        .createQueryBuilder()
        .getMany.mockResolvedValue([
          { id: "instance-1", status: WorkflowStatus.PENDING },
        ]);

      const result = await service.getPendingApprovals("approver-1");

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("expireOldInstances", () => {
    it("should expire old pending instances", async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
      };
      AppDataSource.getRepository().createQueryBuilder.mockReturnValue(
        mockQueryBuilder
      );
      mockQueryBuilder.execute = jest.fn().mockResolvedValue({ affected: 3 });

      const result = await service.expireOldInstances();

      expect(result).toBe(3);
    });
  });
});

describe("AdminWorkflowTypes", () => {
  it("should have all expected sensitive action types", () => {
    const expected = [
      "enable_tool",
      "disable_tool",
      "activate_prompt",
      "update_prompt",
      "delete_prompt",
      "modify_strategy_settings",
      "modify_security_posture",
      "purge_audit_logs",
      "update_ip_blacklist",
      "modify_rate_limits",
      "update_admin_allowed_ips",
    ];

    const values = Object.values(SensitiveActionType);
    for (const action of expected) {
      expect(values).toContain(action);
    }
  });

  it("should have all expected workflow statuses", () => {
    const expected = [
      "pending",
      "approved",
      "rejected",
      "expired",
      "completed",
      "cancelled",
    ];
    const values = Object.values(WorkflowStatus);
    for (const status of expected) {
      expect(values).toContain(status);
    }
  });

  it("should have all risk levels", () => {
    const expected = ["low", "medium", "high", "critical"];
    const values = Object.values(RiskLevel);
    for (const level of expected) {
      expect(values).toContain(level);
    }
  });
});
