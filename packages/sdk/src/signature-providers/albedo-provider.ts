import { ChainId } from "../types";
import { AbortSignalLike } from "../types";
import { BaseSignatureProvider } from "./interfaces";
import {
  SignatureRequest,
  SignatureResult,
  SignatureProviderAccount,
  SignatureProviderConnection,
  SignatureProviderCapabilities,
  SignatureProviderMetadata,
  StellarTransaction,
} from "./types";
import {
  ConnectionError,
  InvalidTransactionError,
  SigningError,
  UserRejectedError,
} from "./errors";

export interface AlbedoProviderConfig {
  enableDebugLogging?: boolean;
  shouldFailConnection?: boolean;
  shouldRejectSigning?: boolean;
}

export class AlbedoSignatureProvider extends BaseSignatureProvider {
  private config: AlbedoProviderConfig;

  constructor(config: AlbedoProviderConfig = {}) {
    super("albedo-provider", {
      name: "Albedo Browser Wallet",
      version: "1.0.0",
      description: "Stellar browser extension integration for signing flows",
      icon: "albedo-icon.png",
      website: "https://albedo.link",
    } satisfies SignatureProviderMetadata);

    this.config = { enableDebugLogging: false, ...config };
  }

  async connect(): Promise<SignatureProviderConnection> {
    if (this.config.shouldFailConnection) {
      throw new ConnectionError("Albedo extension unavailable", this.providerId);
    }

    this.connectionState = {
      isConnected: true,
      connectionId: `albedo-${Date.now()}`,
      metadata: { browserExtension: true, connectedAt: new Date().toISOString() },
    };
    this.notifyConnectionChange(true);
    return this.connectionState;
  }

  async disconnect(): Promise<void> {
    this.connectionState = null;
    this.notifyConnectionChange(false);
  }

  async getAccounts(chainId: ChainId): Promise<SignatureProviderAccount[]> {
    if (chainId !== ChainId.STELLAR) {
      throw new ConnectionError("Albedo only supports Stellar", this.providerId);
    }
    return [{
      address: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      publicKey: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      chainId,
      metadata: { browserExtension: true },
    }];
  }

  async signTransaction(request: SignatureRequest, signal?: AbortSignalLike): Promise<SignatureResult> {
    if (request.transactionData.chainId !== ChainId.STELLAR) {
      throw new InvalidTransactionError("Albedo only signs Stellar transactions", this.providerId, request.transactionData.chainId);
    }

    const tx = request.transactionData.transaction as StellarTransaction;
    if (!tx.sourceAccount || !Array.isArray(tx.operations) || tx.operations.length === 0) {
      throw new InvalidTransactionError("Stellar transaction is missing required fields", this.providerId, ChainId.STELLAR);
    }

    if (this.config.shouldRejectSigning) {
      throw new UserRejectedError(this.providerId);
    }

    return {
      signature: `albedo_sig_${Date.now()}`,
      publicKey: request.accountAddress,
      signedTransaction: { ...tx, signatures: ["albedo_sig"] },
      metadata: { albedo: true, signedAt: new Date().toISOString() },
    };
  }

  getCapabilities(): SignatureProviderCapabilities {
    return {
      supportedChains: [ChainId.STELLAR],
      supportsMultipleAccounts: false,
      requiresUserInteraction: true,
      supportsMessageSigning: true,
      maxConcurrentSignatures: 1,
      signingModes: ["transaction", "message"],
      supportsSubmission: false,
      supportsHealthCheck: true,
      metadata: { browserExtension: true },
    };
  }

  isConnected(): boolean {
    return super.isConnected();
  }

  private log(message: string, data?: unknown): void {
    if (this.config.enableDebugLogging) {
      console.log(`[AlbedoSignatureProvider] ${message}`, data || "");
    }
  }
}
