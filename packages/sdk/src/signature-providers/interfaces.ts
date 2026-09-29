import { ChainId } from "../types";
import { AbortSignalLike } from "../types";
import {
  SignatureRequest,
  SignatureResult,
  SignatureProviderAccount,
  SignatureProviderConnection,
  SignatureProviderCapabilities,
  SignatureProviderMetadata,
} from "./types";

/**
 * Core SignatureProvider interface that all signing providers must implement.
 * This interface provides a standardized contract for integrating multiple
 * wallet and signing solutions within the Chen Pilot SDK.
 */
export interface SignatureProvider {
  // Provider identification
  readonly providerId: string;
  readonly metadata: SignatureProviderMetadata;

  // Connection and lifecycle management
  connect(): Promise<SignatureProviderConnection>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Account management
  getAccounts(chainId: ChainId): Promise<SignatureProviderAccount[]>;

  // Core signing operations
  signTransaction(request: SignatureRequest, signal?: AbortSignalLike): Promise<SignatureResult>;

  // Optional message signing (for providers that support it)
  signMessage?(
    message: string,
    accountAddress: string,
    chainId: ChainId
  ): Promise<SignatureResult>;

  // Provider capabilities and metadata
  getCapabilities(): SignatureProviderCapabilities;

  // Event handling for provider state changes
  onConnectionChange?(callback: (connected: boolean) => void): void;
  onAccountChange?(
    callback: (accounts: SignatureProviderAccount[]) => void
  ): void;
}

/**
 * Base abstract class that provides common functionality for SignatureProvider implementations.
 * Concrete providers can extend this class to inherit shared behavior.
 */
export abstract class BaseSignatureProvider implements SignatureProvider {
  public readonly providerId: string;
  public readonly metadata: SignatureProviderMetadata;

  protected connectionState: SignatureProviderConnection | null = null;
  protected connectionCallbacks: Array<(connected: boolean) => void> = [];
  protected accountCallbacks: Array<
    (accounts: SignatureProviderAccount[]) => void
  > = [];

  constructor(providerId: string, metadata: SignatureProviderMetadata) {
    this.providerId = providerId;
    this.metadata = metadata;
  }

  // Abstract methods that must be implemented by concrete providers
  abstract connect(): Promise<SignatureProviderConnection>;
  abstract disconnect(): Promise<void>;
  abstract getAccounts(chainId: ChainId): Promise<SignatureProviderAccount[]>;
  abstract signTransaction(request: SignatureRequest, signal?: AbortSignalLike): Promise<SignatureResult>;
  abstract getCapabilities(): SignatureProviderCapabilities;

  // Common implementation for connection state
  isConnected(): boolean {
    return this.connectionState?.isConnected ?? false;
  }

  // Event handling implementation
  onConnectionChange(callback: (connected: boolean) => void): void {
    this.connectionCallbacks.push(callback);
  }

  onAccountChange(
    callback: (accounts: SignatureProviderAccount[]) => void
  ): void {
    this.accountCallbacks.push(callback);
  }

  // Protected helper methods for subclasses
  protected notifyConnectionChange(connected: boolean): void {
    this.connectionCallbacks.forEach((callback) => {
      try {
        callback(connected);
      } catch (error) {
        console.error("Error in connection change callback:", error);
      }
    });
  }

  protected notifyAccountChange(accounts: SignatureProviderAccount[]): void {
    this.accountCallbacks.forEach((callback) => {
      try {
        callback(accounts);
      } catch (error) {
        console.error("Error in account change callback:", error);
      }
    });
  }
}
