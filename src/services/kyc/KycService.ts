import config from "../../config/config";
import logger from "../../config/logger";
import { KycProviderFactory } from "./KycProviderFactory";
import { KycOrchestrator } from "./KycOrchestrator";
import { MockKycProvider } from "./providers/mockKycProvider";
import {
  KycGateContext,
  KycGateDecision,
  KycVerificationRequest,
  KycVerificationResult,
} from "./types";

export class KycService {
  constructor(
    private readonly providerFactory: KycProviderFactory,
    private readonly orchestrator = new KycOrchestrator()
  ) {}

  async submitVerification(
    request: KycVerificationRequest,
    providerName?: string
  ): Promise<KycVerificationResult> {
    const provider = this.providerFactory.getProvider(providerName);
    const result = await this.orchestrator.submitVerification(request, () =>
      provider.createVerification(request)
    );

    logger.info("KYC verification submitted", {
      provider: provider.name,
      userId: request.person.userId,
      providerReferenceId: result.providerReferenceId,
      status: result.status,
    });

    return result;
  }

  async getVerificationStatus(
    providerReferenceId: string,
    providerName?: string
  ): Promise<KycVerificationResult | null> {
    const provider = this.providerFactory.getProvider(providerName);
    return provider.getVerificationStatus(providerReferenceId);
  }

  async healthCheck(providerName?: string): Promise<boolean> {
    const provider = this.providerFactory.getProvider(providerName);
    return provider.healthCheck();
  }

  getRegisteredProviders(): string[] {
    return this.providerFactory.getRegisteredProviders();
  }

  async gateAction(context: KycGateContext): Promise<KycGateDecision> {
    return this.orchestrator.gateAction(context);
  }
}

const kycProviderFactory = new KycProviderFactory(config.kyc.defaultProvider);
kycProviderFactory.register(new MockKycProvider());

export const kycService = new KycService(kycProviderFactory);
