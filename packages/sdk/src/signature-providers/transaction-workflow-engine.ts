import { ChainId } from "../types";
import { SignatureProvider } from "./interfaces";
import { ProviderSelectionPreferences, TransactionWorkflowRequest, TransactionWorkflowResult } from "./types";
import { SignatureProviderRegistry } from "./registry";
import { SignatureProviderFactory } from "./provider-factory";
import { SignatureRequest } from "./types";
import { SignatureProviderErrorUtils } from "./errors";
import { throwIfAborted } from "../abort";
import type { AbortSignalLike } from "../types";

export interface TransactionWorkflowSubmitter {
  submit(chainId: ChainId, signedTransaction: unknown, signal?: AbortSignalLike): Promise<{ success: boolean; transactionId?: string; rawResult?: unknown }>;
}

export class TransactionWorkflowEngine {
  constructor(
    private readonly registry: SignatureProviderRegistry,
    private readonly factory: SignatureProviderFactory,
    private readonly submitter?: TransactionWorkflowSubmitter
  ) {}

  async execute(request: TransactionWorkflowRequest, signal?: AbortSignalLike): Promise<TransactionWorkflowResult> {
    throwIfAborted(signal);
    const provider = await this.selectProvider(request.chainId, request.providerPreferences);
    if (!provider.isConnected()) {
      await provider.connect();
    }

    const signatureRequest: SignatureRequest = {
      transactionData: { chainId: request.chainId, transaction: request.transaction as never },
      accountAddress: request.accountAddress,
      metadata: request.metadata,
    };

    try {
      const signature = await provider.signTransaction(signatureRequest, signal);
      const submitted = request.submit && this.submitter && signature.signedTransaction
        ? await this.submitter.submit(request.chainId, signature.signedTransaction, signal)
        : undefined;

      return { providerId: provider.providerId, chainId: request.chainId, signature, submitted, metadata: request.metadata };
    } catch (error) {
      throw SignatureProviderErrorUtils.fromError(error, provider.providerId, request.chainId);
    }
  }

  private async selectProvider(chainId: ChainId, preferences?: ProviderSelectionPreferences): Promise<SignatureProvider> {
    const ranked = this.registry.resolveProviders(chainId, preferences);
    if (ranked.length > 0) {
      const existing = this.registry.listProviders().find((p) => p.providerId === ranked[0].providerId);
      if (existing) return existing;
    }
    return this.factory.getBestProviderForChain(chainId, preferences);
  }
}
