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
  BitcoinTransaction,
  StellarTransaction,
  StarknetTransaction,
} from "./types";
import {
  SignatureProviderError,
  ConnectionError,
  UserRejectedError,
  InvalidTransactionError,
  NetworkError,
  SigningError,
} from "./errors";
import { abortableSleep } from "../abort";

/**
 * Configuration options for MockSignatureProvider behavior
 */
export interface MockProviderConfig {
  // Connection behavior
  connectionDelay?: number;
  shouldFailConnection?: boolean;
  connectionError?: SignatureProviderError;

  // Account behavior
  accounts?: Record<ChainId, SignatureProviderAccount[]>;
  shouldFailGetAccounts?: boolean;
  getAccountsError?: SignatureProviderError;

  // Signing behavior
  signingDelay?: number;
  shouldFailSigning?: boolean;
  signingError?: SignatureProviderError;
  shouldRejectSigning?: boolean;
  rejectionRate?: number; // 0-1, probability of rejection

  // Message signing behavior
  shouldFailMessageSigning?: boolean;
  messageSigningError?: SignatureProviderError;

  // Network simulation
  networkLatency?: number;
  networkFailureRate?: number; // 0-1, probability of network failure

  // Custom capabilities
  customCapabilities?: Partial<SignatureProviderCapabilities>;

  // Logging
  enableLogging?: boolean;
}

/**
 * Mock signature provider for testing and development.
 * Supports all chains and provides configurable behavior for various test scenarios.
 */
export class MockSignatureProvider extends BaseSignatureProvider {
  private config: MockProviderConfig;
  private mockAccounts: Record<ChainId, SignatureProviderAccount[]>;
  private signatureCounter = 0;

  constructor(
    providerId: string = "mock-provider",
    metadata: SignatureProviderMetadata = {
      name: "Mock Signature Provider",
      version: "1.0.0",
      description: "Mock provider for testing and development",
      icon: "mock-icon.png",
    },
    config: MockProviderConfig = {}
  ) {
    super(providerId, metadata);
    this.config = {
      connectionDelay: 100,
      signingDelay: 200,
      networkLatency: 50,
      rejectionRate: 0,
      networkFailureRate: 0,
      enableLogging: false,
      ...config,
    };

    this.mockAccounts = this.initializeDefaultAccounts();
    if (config.accounts) {
      this.mockAccounts = { ...this.mockAccounts, ...config.accounts };
    }
  }

  /**
   * Update the mock provider configuration
   */
  updateConfig(newConfig: Partial<MockProviderConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.accounts) {
      this.mockAccounts = { ...this.mockAccounts, ...newConfig.accounts };
    }
  }

  /**
   * Reset the provider to default state
   */
  reset(): void {
    this.connectionState = null;
    this.signatureCounter = 0;
    this.config = {
      connectionDelay: 100,
      signingDelay: 200,
      networkLatency: 50,
      rejectionRate: 0,
      networkFailureRate: 0,
      enableLogging: false,
    };
    this.mockAccounts = this.initializeDefaultAccounts();
  }

  async connect(): Promise<SignatureProviderConnection> {
    this.log("Attempting to connect...");

    await this.simulateDelay(this.config.connectionDelay);
    await this.simulateNetworkConditions();

    if (this.config.shouldFailConnection) {
      const error =
        this.config.connectionError ||
        new ConnectionError("Mock connection failed", this.providerId);
      this.log("Connection failed:", error.message);
      throw error;
    }

    this.connectionState = {
      isConnected: true,
      connectionId: `mock-connection-${Date.now()}`,
      metadata: {
        mockProvider: true,
        connectedAt: new Date().toISOString(),
      },
    };

    this.log("Connected successfully");
    this.notifyConnectionChange(true);
    return this.connectionState;
  }

  async disconnect(): Promise<void> {
    this.log("Disconnecting...");

    await this.simulateDelay(50);

    this.connectionState = null;
    this.log("Disconnected");
    this.notifyConnectionChange(false);
  }

  async getAccounts(chainId: ChainId): Promise<SignatureProviderAccount[]> {
    this.log(`Getting accounts for chain: ${chainId}`);

    await this.simulateDelay(this.config.networkLatency);
    await this.simulateNetworkConditions();

    if (this.config.shouldFailGetAccounts) {
      const error =
        this.config.getAccountsError ||
        new SigningError("Mock get accounts failed", this.providerId, chainId);
      this.log("Get accounts failed:", error.message);
      throw error;
    }

    const accounts = this.mockAccounts[chainId] || [];
    this.log(`Found ${accounts.length} accounts for ${chainId}`);
    return accounts;
  }

  async signTransaction(request: SignatureRequest, signal?: AbortSignalLike): Promise<SignatureResult> {
    this.log("Signing transaction:", request);

    await this.simulateDelay(this.config.signingDelay, signal);
    await this.simulateNetworkConditions();

    // Simulate user rejection
    if (
      this.config.shouldRejectSigning ||
      Math.random() < (this.config.rejectionRate || 0)
    ) {
      const error = new UserRejectedError(this.providerId);
      this.log("Transaction rejected by user");
      throw error;
    }

    // Simulate signing failure
    if (this.config.shouldFailSigning) {
      const error =
        this.config.signingError ||
        new SigningError(
          "Mock signing failed",
          this.providerId,
          request.transactionData.chainId
        );
      this.log("Signing failed:", error.message);
      throw error;
    }

    // Validate transaction format
    this.validateTransaction(request.transactionData);

    // Generate mock signature
    const signature = this.generateMockSignature(request);
    const publicKey = this.generateMockPublicKey(
      request.accountAddress,
      request.transactionData.chainId
    );
    const signedTransaction = this.generateMockSignedTransaction(request);

    const result: SignatureResult = {
      signature,
      publicKey,
      signedTransaction,
      metadata: {
        mockProvider: true,
        signatureCounter: ++this.signatureCounter,
        signedAt: new Date().toISOString(),
        chainId: request.transactionData.chainId,
      },
    };

    this.log("Transaction signed successfully:", result);
    return result;
  }

  async signMessage?(
    message: string,
    accountAddress: string,
    chainId: ChainId
  ): Promise<SignatureResult> {
    this.log(`Signing message for ${chainId}:`, { message, accountAddress });

    await this.simulateDelay(this.config.signingDelay);
    await this.simulateNetworkConditions();

    if (this.config.shouldFailMessageSigning) {
      const error =
        this.config.messageSigningError ||
        new SigningError(
          "Mock message signing failed",
          this.providerId,
          chainId
        );
      this.log("Message signing failed:", error.message);
      throw error;
    }

    const signature = this.generateMockMessageSignature(
      message,
      accountAddress,
      chainId
    );
    const publicKey = this.generateMockPublicKey(accountAddress, chainId);

    const result: SignatureResult = {
      signature,
      publicKey,
      metadata: {
        mockProvider: true,
        messageSignature: true,
        signedAt: new Date().toISOString(),
        chainId,
        message,
      },
    };

    this.log("Message signed successfully:", result);
    return result;
  }

  getCapabilities(): SignatureProviderCapabilities {
    const defaultCapabilities: SignatureProviderCapabilities = {
      supportedChains: [ChainId.BITCOIN, ChainId.STELLAR, ChainId.STARKNET],
      supportsMultipleAccounts: true,
      requiresUserInteraction: false,
      supportsMessageSigning: true,
      maxConcurrentSignatures: 10,
      metadata: {
        mockProvider: true,
        testingCapabilities: true,
      },
    };

    return { ...defaultCapabilities, ...this.config.customCapabilities };
  }

  /**
   * Simulate specific error scenarios for testing
   */
  simulateError(error: SignatureProviderError): void {
    this.log("Simulating error:", error);
    throw error;
  }

  /**
   * Get current mock configuration
   */
  getConfig(): MockProviderConfig {
    return { ...this.config };
  }

  /**
   * Get mock accounts for all chains
   */
  getMockAccounts(): Record<ChainId, SignatureProviderAccount[]> {
    return { ...this.mockAccounts };
  }

  /**
   * Add mock accounts for a specific chain
   */
  addMockAccounts(
    chainId: ChainId,
    accounts: SignatureProviderAccount[]
  ): void {
    if (!this.mockAccounts[chainId]) {
      this.mockAccounts[chainId] = [];
    }
    this.mockAccounts[chainId].push(...accounts);
    this.log(`Added ${accounts.length} mock accounts for ${chainId}`);
  }

  /**
   * Clear mock accounts for a specific chain
   */
  clearMockAccounts(chainId: ChainId): void {
    this.mockAccounts[chainId] = [];
    this.log(`Cleared mock accounts for ${chainId}`);
  }

  private initializeDefaultAccounts(): Record<
    ChainId,
    SignatureProviderAccount[]
  > {
    return {
      [ChainId.BITCOIN]: [
        {
          address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
          publicKey:
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
          chainId: ChainId.BITCOIN,
          derivationPath: "m/84'/0'/0'/0/0",
          metadata: { accountName: "Bitcoin Account 1", balance: "0.001 BTC" },
        },
        {
          address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
          publicKey:
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81799",
          chainId: ChainId.BITCOIN,
          derivationPath: "m/84'/0'/0'/0/1",
          metadata: { accountName: "Bitcoin Account 2", balance: "0.005 BTC" },
        },
      ],
      [ChainId.STELLAR]: [
        {
          address: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          publicKey: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          chainId: ChainId.STELLAR,
          derivationPath: "m/44'/148'/0'",
          metadata: { accountName: "Stellar Account 1", balance: "100 XLM" },
        },
        {
          address: "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
          publicKey: "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
          chainId: ChainId.STELLAR,
          derivationPath: "m/44'/148'/1'",
          metadata: { accountName: "Stellar Account 2", balance: "250 XLM" },
        },
      ],
      [ChainId.STARKNET]: [
        {
          address:
            "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
          publicKey:
            "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
          chainId: ChainId.STARKNET,
          derivationPath: "m/44'/9004'/0'/0/0",
          metadata: { accountName: "Starknet Account 1", balance: "1.5 ETH" },
        },
        {
          address:
            "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          publicKey:
            "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          chainId: ChainId.STARKNET,
          derivationPath: "m/44'/9004'/0'/0/1",
          metadata: { accountName: "Starknet Account 2", balance: "0.8 ETH" },
        },
      ],
    };
  }

  private validateTransaction(transactionData: unknown): void {
    const { chainId, transaction } = transactionData as {
      chainId: ChainId;
      transaction: unknown;
    };

    switch (chainId) {
      case ChainId.BITCOIN:
        this.validateBitcoinTransaction(transaction as BitcoinTransaction);
        break;
      case ChainId.STELLAR:
        this.validateStellarTransaction(transaction as StellarTransaction);
        break;
      case ChainId.STARKNET:
        this.validateStarknetTransaction(transaction as StarknetTransaction);
        break;
      default:
        throw new InvalidTransactionError(
          `Unsupported chain: ${chainId}`,
          this.providerId,
          chainId
        );
    }
  }

  private validateBitcoinTransaction(tx: BitcoinTransaction): void {
    if (!tx.inputs || !Array.isArray(tx.inputs) || tx.inputs.length === 0) {
      throw new InvalidTransactionError(
        "Bitcoin transaction must have inputs",
        this.providerId,
        ChainId.BITCOIN
      );
    }
    if (!tx.outputs || !Array.isArray(tx.outputs) || tx.outputs.length === 0) {
      throw new InvalidTransactionError(
        "Bitcoin transaction must have outputs",
        this.providerId,
        ChainId.BITCOIN
      );
    }
  }

  private validateStellarTransaction(tx: StellarTransaction): void {
    if (!tx.sourceAccount) {
      throw new InvalidTransactionError(
        "Stellar transaction must have source account",
        this.providerId,
        ChainId.STELLAR
      );
    }
    if (
      !tx.operations ||
      !Array.isArray(tx.operations) ||
      tx.operations.length === 0
    ) {
      throw new InvalidTransactionError(
        "Stellar transaction must have operations",
        this.providerId,
        ChainId.STELLAR
      );
    }
  }

  private validateStarknetTransaction(tx: StarknetTransaction): void {
    if (!tx.contractAddress) {
      throw new InvalidTransactionError(
        "Starknet transaction must have contract address",
        this.providerId,
        ChainId.STARKNET
      );
    }
    if (!tx.entrypoint) {
      throw new InvalidTransactionError(
        "Starknet transaction must have entrypoint",
        this.providerId,
        ChainId.STARKNET
      );
    }
  }

  private generateMockSignature(request: SignatureRequest): string {
    const { chainId } = request.transactionData;
    const timestamp = Date.now();
    const counter = this.signatureCounter;

    // Generate chain-specific mock signatures
    switch (chainId) {
      case ChainId.BITCOIN:
        return `304402${timestamp.toString(16).padStart(8, "0")}${counter.toString(16).padStart(4, "0")}`;
      case ChainId.STELLAR:
        return `${timestamp.toString(16).padStart(16, "0")}${counter.toString(16).padStart(8, "0")}`.padEnd(
          128,
          "0"
        );
      case ChainId.STARKNET:
        return `0x${timestamp.toString(16).padStart(16, "0")}${counter.toString(16).padStart(8, "0")}`.padEnd(
          66,
          "0"
        );
      default:
        return `mock_signature_${timestamp}_${counter}`;
    }
  }

  private generateMockPublicKey(address: string, chainId: ChainId): string {
    // For mock purposes, derive public key from address
    const hash = this.simpleHash(address + chainId);

    switch (chainId) {
      case ChainId.BITCOIN:
        return `02${hash.substring(0, 62)}`;
      case ChainId.STELLAR:
        return address; // Stellar addresses are public keys
      case ChainId.STARKNET:
        return `0x${hash.substring(0, 62)}`;
      default:
        return `mock_pubkey_${hash.substring(0, 16)}`;
    }
  }

  private generateMockSignedTransaction(request: SignatureRequest): unknown {
    const { chainId, transaction } = request.transactionData;

    switch (chainId) {
      case ChainId.BITCOIN:
        return {
          ...(transaction as object),
          signatures: [`mock_signature_${this.signatureCounter}`],
          txid: `mock_txid_${Date.now()}`,
        };
      case ChainId.STELLAR:
        return {
          ...(transaction as object),
          signatures: [`mock_signature_${this.signatureCounter}`],
          hash: `mock_hash_${Date.now()}`,
        };
      case ChainId.STARKNET:
        return {
          ...(transaction as object),
          signature: [
            `0x${this.signatureCounter.toString(16)}`,
            `0x${Date.now().toString(16)}`,
          ],
          transaction_hash: `0x${Date.now().toString(16)}`,
        };
      default:
        return {
          ...(transaction as object),
          signature: `mock_signature_${this.signatureCounter}`,
        };
    }
  }

  private generateMockMessageSignature(
    message: string,
    address: string,
    chainId: ChainId
  ): string {
    const hash = this.simpleHash(message + address + chainId);
    return `mock_msg_sig_${hash.substring(0, 16)}`;
  }

  private async simulateDelay(ms?: number, signal?: AbortSignalLike): Promise<void> {
    if (ms && ms > 0) {
      await abortableSleep(ms, signal);
    }
  }

  private async simulateNetworkConditions(): Promise<void> {
    // Simulate network latency
    if (this.config.networkLatency) {
      await this.simulateDelay(this.config.networkLatency);
    }

    // Simulate network failures
    if (
      this.config.networkFailureRate &&
      Math.random() < this.config.networkFailureRate
    ) {
      throw new NetworkError("Simulated network failure", this.providerId);
    }
  }

  private simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, "0").repeat(8);
  }

  private log(message: string, data?: unknown): void {
    if (this.config.enableLogging) {
      console.log(
        `[MockSignatureProvider:${this.providerId}] ${message}`,
        data || ""
      );
    }
  }
}
