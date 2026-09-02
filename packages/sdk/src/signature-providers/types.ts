import { ChainId } from "../types";
import { ProviderType, ProviderConfig } from "./provider-factory";

// Re-exported (canonical definitions live in ./provider-factory)
export { ProviderType, ProviderConfig };

// Base transaction types for different chains
export interface BitcoinTransaction {
  inputs: Array<{
    txid: string;
    vout: number;
    scriptSig?: string;
    sequence?: number;
  }>;
  outputs: Array<{
    value: number;
    scriptPubKey: string;
  }>;
  version?: number;
  lockTime?: number;
}

export interface StellarTransaction {
  sourceAccount: string;
  fee: string;
  sequenceNumber: string;
  operations: Array<Record<string, unknown>>;
  memo?: {
    type: string;
    value: string;
  };
  timeBounds?: {
    minTime: string;
    maxTime: string;
  };
}

export interface StarknetTransaction {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
  version?: string;
  maxFee?: string;
  nonce?: string;
}

// Union type for all supported transaction types
export type ChainTransaction =
  | { chainId: ChainId.BITCOIN; transaction: BitcoinTransaction }
  | { chainId: ChainId.STELLAR; transaction: StellarTransaction }
  | { chainId: ChainId.STARKNET; transaction: StarknetTransaction };

// Signature request and result types
export interface SignatureRequest {
  transactionData: ChainTransaction;
  accountAddress: string;
  metadata?: Record<string, unknown>;
}

export interface SignatureResult {
  signature: string;
  publicKey: string;
  signedTransaction?: unknown;
  metadata?: Record<string, unknown>;
}

// Provider account information
export interface SignatureProviderAccount {
  address: string;
  publicKey: string;
  chainId: ChainId;
  derivationPath?: string;
  metadata?: Record<string, unknown>;
}

// Provider connection information
export interface SignatureProviderConnection {
  isConnected: boolean;
  connectionId: string;
  metadata?: Record<string, unknown>;
}

// Provider capabilities
export interface SignatureProviderCapabilities {
  supportedChains: ChainId[];
  supportsMultipleAccounts: boolean;
  requiresUserInteraction: boolean;
  supportsMessageSigning: boolean;
  maxConcurrentSignatures: number;
  signingModes?: Array<"transaction" | "message" | "batch" | "offline">;
  supportsSubmission?: boolean;
  supportsHealthCheck?: boolean;
  metadata?: Record<string, unknown>;
}

// Provider metadata
export interface SignatureProviderMetadata {
  name: string;
  version: string;
  description: string;
  icon?: string;
  website?: string;
}

// SDK Configuration
export interface SignatureProviderSDKConfig {
  defaultProviders?: ProviderType[];
  autoDiscovery?: boolean;
  enableMetrics?: boolean;
  enableLogging?: boolean;
  connectionTimeout?: number;
  maxRetries?: number;
  errorRecovery?: {
    enabled: boolean;
    maxRetries: number;
    retryDelay: number;
  };
  registry?: {
    autoRegister?: boolean;
    validateProviders?: boolean;
    [key: string]: unknown;
  };
}

export interface SignatureProviderContext {
  registry: unknown;
  factory: unknown;
  coordinator: unknown;
  errorRecovery: unknown;
}

export interface ProviderHealthCheck {
  providerId: string;
  healthy: boolean;
  connected: boolean;
  lastChecked: Date;
  capabilities: SignatureProviderCapabilities;
  errors?: Error[];
  metadata?: Record<string, unknown>;
}

export interface BatchOperationResult<T> {
  successful: T[];
  failed: Array<{ error: Error; input?: unknown }>;
  totalCount: number;
  successCount: number;
  failureCount: number;
  duration: number;
}

export interface ProviderMetrics {
  providerId: string;
  connectionCount: number;
  signatureCount: number;
  errorCount: number;
  averageSigningTime: number;
  lastActivity: Date;
  uptime: number;
}

export interface ProviderSelectionPreferences {
  preferHardwareWallet?: boolean;
  preferBrowserExtension?: boolean;
  requireUserInteraction?: boolean;
  requireMessageSigning?: boolean;
  minConcurrentSignatures?: number;
  preferredProviderIds?: string[];
}

export interface ProviderResolutionRequest {
  chainId: ChainId;
  operation?: "transaction" | "message" | "submission";
  preferences?: ProviderSelectionPreferences;
  fallbackToMock?: boolean;
}

export interface ProviderResolutionResult {
  providerType: ProviderType;
  providerId?: string;
  score: number;
  capabilities: SignatureProviderCapabilities;
  reason: string[];
}

export interface TransactionWorkflowRequest {
  chainId: ChainId;
  transaction: ChainTransaction["transaction"];
  accountAddress: string;
  providerPreferences?: ProviderSelectionPreferences;
  submit?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TransactionWorkflowResult {
  providerId: string;
  chainId: ChainId;
  signature: SignatureResult;
  submitted?: {
    success: boolean;
    transactionId?: string;
    rawResult?: unknown;
  };
  metadata?: Record<string, unknown>;
}
