import { AuditAction } from "../../src/AuditLog/auditLog.entity";
import { KycProviderFactory } from "../../src/services/kyc/KycProviderFactory";
import { KycOrchestrator } from "../../src/services/kyc/KycOrchestrator";
import { KycService } from "../../src/services/kyc/KycService";
import { MockKycProvider } from "../../src/services/kyc/providers/mockKycProvider";
import { KycVerificationRequest } from "../../src/services/kyc/types";

describe("KYC compliance orchestration", () => {
  const request: KycVerificationRequest = {
    person: {
      userId: "user-kyc-1",
      fullName: "Jane Compliance",
      email: "jane@example.com",
      countryCode: "US",
    },
    documents: [{ type: "passport", documentId: "passport-1" }],
    referenceId: "onboarding-1",
  };

  it("submits through providers while preserving audit metadata", async () => {
    const auditEvents: unknown[] = [];
    const orchestrator = new KycOrchestrator(undefined, {
      log: jest.fn(async (event) => {
        auditEvents.push(event);
      }),
    });
    const factory = new KycProviderFactory("mock");
    factory.register(new MockKycProvider());

    const service = new KycService(factory, orchestrator);
    const result = await service.submitVerification(request);

    expect(result.status).toBe("pending");
    expect(auditEvents).toEqual([
      expect.objectContaining({
        userId: "user-kyc-1",
        action: AuditAction.KYC_POLICY_DECISION,
        resource: "kyc:submit_verification",
        success: true,
        metadata: expect.objectContaining({
          provider: "mock",
          providerReferenceId: result.providerReferenceId,
          referenceId: "onboarding-1",
        }),
      }),
    ]);
  });

  it("gates critical actions from the orchestration boundary", async () => {
    const service = new KycService(
      new KycProviderFactory("mock"),
      new KycOrchestrator(undefined, { log: jest.fn(async () => undefined) })
    );

    await expect(
      service.gateAction({
        userId: "user-kyc-1",
        action: "trade.execute",
        verificationStatus: "pending",
      })
    ).resolves.toMatchObject({
      allowed: false,
      requiredStatus: "approved",
    });

    await expect(
      service.gateAction({
        userId: "user-kyc-1",
        action: "trade.execute",
        verificationStatus: "approved",
      })
    ).resolves.toMatchObject({
      allowed: true,
    });
  });
});
