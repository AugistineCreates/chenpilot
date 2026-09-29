import { AppDataSource } from "../../config/Datasource";
import { User } from "../../Auth/user.entity";
import { Contact } from "../../Contacts/contact.entity";
import { RefreshToken } from "../../Auth/refreshToken.entity";
import { BotSession } from "../../Bot/botSession.entity";
import { BotIdentity } from "../../Auth/botIdentity.entity";
import { AgentExecutionMetrics } from "../../Agents/agentExecutionMetrics.entity";
import { AuditLog } from "../../AuditLog/auditLog.entity";
import {
  withTenantContext,
  withSystemContext,
  withAdminContext,
  checkRLSStatus,
} from "../../utils/rlsTransaction";
import { QueryRunner } from "typeorm";

describe("Tenant Isolation via RLS", () => {
  let queryRunner: QueryRunner;
  let user1: User;
  let user2: User;
  let contact1: Contact;
  let contact2: Contact;

  beforeAll(async () => {
    // Ensure database connection is initialized
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  afterAll(async () => {
    // Clean up
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  beforeEach(async () => {
    queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // Create test users
    const userRepo = queryRunner.manager.getRepository(User);
    
    user1 = userRepo.create({
      name: `test-user-1-${Date.now()}`,
      email: `user1-${Date.now()}@test.com`,
      address: `GDUSER1TEST${Date.now()}`,
      role: "user",
      encryptedPrivateKey: "encrypted_key_1",
    });
    await userRepo.save(user1);

    user2 = userRepo.create({
      name: `test-user-2-${Date.now()}`,
      email: `user2-${Date.now()}@test.com`,
      address: `GDUSER2TEST${Date.now()}`,
      role: "user",
      encryptedPrivateKey: "encrypted_key_2",
    });
    await userRepo.save(user2);

    // Create test contacts
    const contactRepo = queryRunner.manager.getRepository(Contact);
    
    contact1 = contactRepo.create({
      userId: user1.id,
      name: "User 1 Contact",
      address: "GDCONTACT1TEST",
      network: "testnet",
    });
    await contactRepo.save(contact1);

    contact2 = contactRepo.create({
      userId: user2.id,
      name: "User 2 Contact",
      address: "GDCONTACT2TEST",
      network: "testnet",
    });
    await contactRepo.save(contact2);

    await queryRunner.commitTransaction();
  });

  afterEach(async () => {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    await queryRunner.release();
  });

  describe("Contact Isolation", () => {
    it("should allow user to see only their own contacts", async () => {
      const contacts = await withTenantContext(user1.id, async (qr) => {
        return qr.manager.find(Contact);
      });

      expect(contacts).toHaveLength(1);
      expect(contacts[0].id).toBe(contact1.id);
      expect(contacts[0].userId).toBe(user1.id);
    });

    it("should prevent user from accessing another user's contacts", async () => {
      const contacts = await withTenantContext(user1.id, async (qr) => {
        // Try to query for user2's contact
        return qr.manager.find(Contact, {
          where: { userId: user2.id },
        });
      });

      // RLS should filter this out even though we explicitly queried for it
      expect(contacts).toHaveLength(0);
    });

    it("should prevent user from reading another user's contact by ID", async () => {
      const contact = await withTenantContext(user1.id, async (qr) => {
        return qr.manager.findOne(Contact, {
          where: { id: contact2.id },
        });
      });

      expect(contact).toBeNull();
    });

    it("should prevent user from updating another user's contact", async () => {
      await expect(async () => {
        await withTenantContext(user1.id, async (qr) => {
          await qr.manager.update(Contact, contact2.id, {
            name: "Hacked Name",
          });
        });
      }).rejects.toThrow();
    });

    it("should prevent user from deleting another user's contact", async () => {
      await expect(async () => {
        await withTenantContext(user1.id, async (qr) => {
          await qr.manager.delete(Contact, contact2.id);
        });
      }).rejects.toThrow();
    });

    it("should allow user to create contact for themselves", async () => {
      const newContact = await withTenantContext(user1.id, async (qr) => {
        const contactRepo = qr.manager.getRepository(Contact);
        const contact = contactRepo.create({
          userId: user1.id,
          name: "New Contact",
          address: "GDNEWCONTACT",
          network: "testnet",
        });
        return contactRepo.save(contact);
      });

      expect(newContact.userId).toBe(user1.id);
      expect(newContact.name).toBe("New Contact");
    });

    it("should prevent user from creating contact for another user", async () => {
      await expect(async () => {
        await withTenantContext(user1.id, async (qr) => {
          const contactRepo = qr.manager.getRepository(Contact);
          const contact = contactRepo.create({
            userId: user2.id, // Try to create for different user
            name: "Malicious Contact",
            address: "GDMALICIOUS",
            network: "testnet",
          });
          await contactRepo.save(contact);
        });
      }).rejects.toThrow();
    });
  });

  describe("Refresh Token Isolation", () => {
    let token1: RefreshToken;
    let token2: RefreshToken;

    beforeEach(async () => {
      const tokenRepo = queryRunner.manager.getRepository(RefreshToken);
      
      token1 = tokenRepo.create({
        userId: user1.id,
        token: "token1",
        expiresAt: new Date(Date.now() + 86400000),
      });
      await tokenRepo.save(token1);

      token2 = tokenRepo.create({
        userId: user2.id,
        token: "token2",
        expiresAt: new Date(Date.now() + 86400000),
      });
      await tokenRepo.save(token2);
    });

    it("should prevent user from accessing another user's refresh tokens", async () => {
      const tokens = await withTenantContext(user1.id, async (qr) => {
        return qr.manager.find(RefreshToken);
      });

      expect(tokens).toHaveLength(1);
      expect(tokens[0].userId).toBe(user1.id);
    });

    it("should prevent user from revoking another user's token", async () => {
      await expect(async () => {
        await withTenantContext(user1.id, async (qr) => {
          await qr.manager.update(RefreshToken, token2.id, {
            isRevoked: true,
          });
        });
      }).rejects.toThrow();
    });
  });

  describe("Bot Session Isolation", () => {
    let session1: BotSession;
    let session2: BotSession;

    beforeEach(async () => {
      const sessionRepo = queryRunner.manager.getRepository(BotSession);
      
      session1 = sessionRepo.create({
        userId: user1.id,
        platform: "telegram",
        sessionType: "payment",
        sessionData: { step: 1 },
      });
      await sessionRepo.save(session1);

      session2 = sessionRepo.create({
        userId: user2.id,
        platform: "discord",
        sessionType: "swap",
        sessionData: { step: 1 },
      });
      await sessionRepo.save(session2);
    });

    it("should isolate bot sessions between users", async () => {
      const sessions = await withTenantContext(user1.id, async (qr) => {
        return qr.manager.find(BotSession);
      });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].userId).toBe(user1.id);
    });

    it("should prevent reading another user's session data", async () => {
      const session = await withTenantContext(user1.id, async (qr) => {
        return qr.manager.findOne(BotSession, {
          where: { id: session2.id },
        });
      });

      expect(session).toBeNull();
    });
  });

  describe("Bot Identity Isolation", () => {
    let identity1: BotIdentity;
    let identity2: BotIdentity;

    beforeEach(async () => {
      const identityRepo = queryRunner.manager.getRepository(BotIdentity);
      
      identity1 = identityRepo.create({
        userId: user1.id,
        platform: "telegram",
        platformUserId: `tg_${Date.now()}_1`,
        platformUsername: "user1_tg",
      });
      await identityRepo.save(identity1);

      identity2 = identityRepo.create({
        userId: user2.id,
        platform: "discord",
        platformUserId: `dc_${Date.now()}_2`,
        platformUsername: "user2_dc",
      });
      await identityRepo.save(identity2);
    });

    it("should prevent access to another user's bot identities", async () => {
      const identities = await withTenantContext(user1.id, async (qr) => {
        return qr.manager.find(BotIdentity);
      });

      expect(identities).toHaveLength(1);
      expect(identities[0].userId).toBe(user1.id);
    });

    it("should prevent unlinking another user's bot identity", async () => {
      await expect(async () => {
        await withTenantContext(user1.id, async (qr) => {
          await qr.manager.delete(BotIdentity, identity2.id);
        });
      }).rejects.toThrow();
    });
  });

  describe("Agent Execution Metrics Isolation", () => {
    let metrics1: AgentExecutionMetrics;
    let metrics2: AgentExecutionMetrics;

    beforeEach(async () => {
      const metricsRepo = queryRunner.manager.getRepository(AgentExecutionMetrics);
      
      metrics1 = metricsRepo.create({
        userId: user1.id,
        agentName: "payment-agent",
        executionTime: 1000,
        success: true,
      });
      await metricsRepo.save(metrics1);

      metrics2 = metricsRepo.create({
        userId: user2.id,
        agentName: "swap-agent",
        executionTime: 2000,
        success: true,
      });
      await metricsRepo.save(metrics2);
    });

    it("should isolate execution metrics between users", async () => {
      const metrics = await withTenantContext(user1.id, async (qr) => {
        return qr.manager.find(AgentExecutionMetrics);
      });

      expect(metrics.length).toBeGreaterThanOrEqual(1);
      expect(metrics.every(m => m.userId === user1.id || m.userId === null)).toBe(true);
      expect(metrics.some(m => m.userId === user2.id)).toBe(false);
    });
  });

  describe("Audit Log Isolation", () => {
    let auditLog1: AuditLog;
    let auditLog2: AuditLog;

    beforeEach(async () => {
      const auditRepo = queryRunner.manager.getRepository(AuditLog);
      
      auditLog1 = auditRepo.create({
        userId: user1.id,
        category: "authentication",
        action: "login",
        success: true,
        eventHash: "hash1",
      });
      await auditRepo.save(auditLog1);

      auditLog2 = auditRepo.create({
        userId: user2.id,
        category: "transaction",
        action: "payment",
        success: true,
        eventHash: "hash2",
      });
      await auditRepo.save(auditLog2);
    });

    it("should allow users to read only their own audit logs", async () => {
      const logs = await withTenantContext(user1.id, async (qr) => {
        return qr.manager.find(AuditLog, {
          where: { userId: user1.id },
        });
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.every(log => log.userId === user1.id || log.userId === null)).toBe(true);
    });

    it("should allow users to create audit logs", async () => {
      const newLog = await withTenantContext(user1.id, async (qr) => {
        const auditRepo = qr.manager.getRepository(AuditLog);
        const log = auditRepo.create({
          userId: user1.id,
          category: "security",
          action: "test_action",
          success: true,
          eventHash: "test_hash",
        });
        return auditRepo.save(log);
      });

      expect(newLog.userId).toBe(user1.id);
    });
  });

  describe("System Context", () => {
    it("should allow system context to access all records", async () => {
      const contacts = await withSystemContext(async (qr) => {
        return qr.manager.find(Contact);
      });

      // System should see all contacts
      expect(contacts.length).toBeGreaterThanOrEqual(2);
      expect(contacts.some(c => c.userId === user1.id)).toBe(true);
      expect(contacts.some(c => c.userId === user2.id)).toBe(true);
    });

    it("should allow system to write metrics without userId", async () => {
      const metrics = await withSystemContext(async (qr) => {
        const metricsRepo = qr.manager.getRepository(AgentExecutionMetrics);
        const metric = metricsRepo.create({
          userId: null, // System-level metric
          agentName: "system-agent",
          executionTime: 500,
          success: true,
        });
        return metricsRepo.save(metric);
      });

      expect(metrics.userId).toBeNull();
    });
  });

  describe("Admin Context", () => {
    it("should allow admin to bypass RLS and access all records", async () => {
      const contacts = await withAdminContext(
        "admin-user",
        "Data migration test",
        async (qr) => {
          return qr.manager.find(Contact);
        }
      );

      // Admin should see all contacts
      expect(contacts.length).toBeGreaterThanOrEqual(2);
      expect(contacts.some(c => c.userId === user1.id)).toBe(true);
      expect(contacts.some(c => c.userId === user2.id)).toBe(true);
    });

    it("should audit admin bypass operations", async () => {
      await withAdminContext(
        "admin-user",
        "Update contact for support ticket",
        async (qr) => {
          await qr.manager.update(Contact, contact1.id, {
            name: "Updated by Admin",
          });
        },
        {
          auditMetadata: {
            operation: "UPDATE_CONTACT",
            tableName: "contact",
            recordId: contact1.id,
            ticketId: "SUPPORT-123",
          },
        }
      );

      // Verify audit log was created
      const auditLogs = await withSystemContext(async (qr) => {
        return qr.manager.query(
          `SELECT * FROM rls_bypass_audit WHERE "executedBy" = $1`,
          ["admin-user"]
        );
      });

      expect(auditLogs.length).toBeGreaterThanOrEqual(1);
      expect(auditLogs[0].reason).toBe("Update contact for support ticket");
      expect(auditLogs[0].tableName).toBe("contact");
    });
  });

  describe("RLS Status Verification", () => {
    it("should confirm RLS is enabled and context is set", async () => {
      await withTenantContext(user1.id, async (qr) => {
        const status = await checkRLSStatus(qr);
        
        expect(status.currentUserId).toBe(user1.id);
        expect(status.currentRole).toBe("app_user");
        expect(status.rlsEnabled).toBe(true);
      });
    });

    it("should confirm admin role has bypass", async () => {
      await withAdminContext("admin", "test", async (qr) => {
        const roleResult = await qr.query(`SELECT current_role`);
        expect(roleResult[0].current_role).toBe("app_admin");
      });
    });
  });

  describe("Background Job Access", () => {
    it("should allow background jobs to use system context", async () => {
      // Simulate a background job that needs to process metrics for all users
      const allMetrics = await withSystemContext(async (qr) => {
        return qr.manager.find(AgentExecutionMetrics);
      });

      // Should have access to metrics from all users
      expect(allMetrics).toBeDefined();
    });

    it("should allow background jobs to create audit logs for any user", async () => {
      const log = await withSystemContext(async (qr) => {
        const auditRepo = qr.manager.getRepository(AuditLog);
        const auditLog = auditRepo.create({
          userId: user1.id,
          category: "system",
          action: "automated_cleanup",
          success: true,
          eventHash: "system_hash",
          metadata: { source: "background_job" },
        });
        return auditRepo.save(auditLog);
      });

      expect(log.userId).toBe(user1.id);
      expect(log.action).toBe("automated_cleanup");
    });
  });
});
