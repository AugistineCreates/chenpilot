import { ChainId } from "../types";
import { AbortSignalLike } from "../types";
import { BaseSignatureProvider } from "./interfaces";
import {
  SignatureRequest,
  SignatureResult,
  SignatureProviderAccount,
  SignatureProviderConnection,
  SignatureProviderCapabilities,
  BitcoinTransaction,
  StellarTransaction,
  StarknetTransaction,
} from "./types";
import {
  DeviceNotFoundError,
  DeviceLockedError,
  DeviceBusyError,
  HardwareWalletError,
  UnsupportedChainError,
  InvalidTransactionError,
  UserRejectedError,
  ConnectionError,
  SigningError,
} from "./errors";

/**
 * Configuration for LedgerSignatureProvider
 */
export interface LedgerProviderConfig {
  // Connection settings
  connectionTimeout?: number;
  devicePollingInterval?: number;
  maxConnectionRetries?: number;

  // App settings
  requiredApps?: Partial<Record<ChainId, string>>;
  autoOpenApps?: boolean;

  // Derivation paths
  defaultDerivationPaths?: Partial<Record<ChainId, string>>;

  // Debug settings
  enableDebugLogging?: boolean;
}

/**
 * Ledger device information
 */
interface LedgerDeviceInfo {
  productId: number;
  vendorId: number;
  productName: string;
  manufacturerName: string;
  serialNumber?: string;
}

/**
 * Ledger app information
 */
interface LedgerAppInfo {
  name: string;
  version: string;
  flags: number;
}

/**
 * Mock Ledger transport interface for development
 * In a real implementation, this would use @ledgerhq/hw-transport-webusb or similar
 */
interface LedgerTransport {
  send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Buffer
  ): Promise<Buffer>;
  close(): Promise<void>;
  setScrambleKey(key: string): void;
}

/**
 * Mock Ledger transport implementation for development and testing
 */
class MockLedgerTransport implements LedgerTransport {
  private isOpen = true;
  private currentApp = "Dashboard";
  private deviceLocked = false;
  private deviceBusy = false;

  async send(
    cla: number,
    ins: number,
    _p1: number,
    _p2: number,
    _data?: Buffer
  ): Promise<Buffer> {
    if (!this.isOpen) {
      throw new Error("Transport is closed");
    }

    if (this.deviceBusy) {
      throw new Error("Device is busy");
    }

    if (this.deviceLocked) {
      throw new Error("Device is locked");
    }

    // Simulate device responses based on APDU commands
    return this.simulateAPDUResponse(cla, ins, _p1, _p2, _data);
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }

  setScrambleKey(_key: string): void {
    void _key;
    // Mock implementation
  }

  // Mock control methods for testing
  setDeviceLocked(locked: boolean): void {
    this.deviceLocked = locked;
  }

  setDeviceBusy(busy: boolean): void {
    this.deviceBusy = busy;
  }

  setCurrentApp(app: string): void {
    this.currentApp = app;
  }

  private async simulateAPDUResponse(
    _cla: number,
    ins: number,
    _p1: number,
    _p2: number,
    _data?: Buffer
  ): Promise<Buffer> {
    void _cla;
    void _p1;
    void _p2;
    void _data;
    // Simulate various APDU responses
    if (ins === 0x01) {
      // Get app info
      return Buffer.concat([
        Buffer.from(this.currentApp, "ascii"),
        Buffer.from([0x01, 0x00, 0x00]), // Version 1.0.0
        Buffer.from([0x90, 0x00]), // Success
      ]);
    }

    if (ins === 0x02) {
      // Get public key
      return Buffer.concat([
        Buffer.from(
          "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
          "hex"
        ),
        Buffer.from([0x90, 0x00]), // Success
      ]);
    }

    if (ins === 0x04) {
      // Sign transaction
      // Simulate user confirmation delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Mock signature
      return Buffer.concat([
        Buffer.from(
          "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "hex"
        ),
        Buffer.from([0x90, 0x00]), // Success
      ]);
    }

    // Default success response
    return Buffer.from([0x90, 0x00]);
  }
}

/**
 * Ledger hardware wallet signature provider implementation
 */
export class LedgerSignatureProvider extends BaseSignatureProvider {
  private config: LedgerProviderConfig;
  private transport: LedgerTransport | null = null;
  private deviceInfo: LedgerDeviceInfo | null = null;
  private currentApp: LedgerAppInfo | null = null;
  private cachedAccounts: Map<string, SignatureProviderAccount[]> = new Map();

  constructor(config: LedgerProviderConfig = {}) {
    super("ledger-provider", {
      name: "Ledger Hardware Wallet",
      version: "1.0.0",
      description:
        "Ledger hardware wallet integration for secure transaction signing",
      icon: "ledger-icon.png",
      website: "https://www.ledger.com",
    });

    this.config = {
      connectionTimeout: 10000,
      devicePollingInterval: 1000,
      maxConnectionRetries: 3,
      requiredApps: {
        [ChainId.BITCOIN]: "Bitcoin",
        [ChainId.STELLAR]: "Stellar",
        [ChainId.STARKNET]: "Starknet",
      },
      autoOpenApps: false,
      defaultDerivationPaths: {
        [ChainId.BITCOIN]: "m/84'/0'/0'/0/0",
        [ChainId.STELLAR]: "m/44'/148'/0'",
        [ChainId.STARKNET]: "m/44'/9004'/0'/0/0",
      },
      enableDebugLogging: false,
      ...config,
    };
  }

  async connect(): Promise<SignatureProviderConnection> {
    this.log("Attempting to connect to Ledger device...");

    try {
      // In a real implementation, this would use @ledgerhq/hw-transport-webusb
      // For now, we'll use a mock transport for development
      this.transport = await this.createTransport();

      // Get device information
      this.deviceInfo = await this.getDeviceInfo();

      // Get current app info
      this.currentApp = await this.getAppInfo();

      this.connectionState = {
        isConnected: true,
        connectionId: `ledger-${this.deviceInfo.serialNumber || Date.now()}`,
        metadata: {
          deviceInfo: this.deviceInfo,
          currentApp: this.currentApp,
          connectedAt: new Date().toISOString(),
        },
      };

      this.log("Successfully connected to Ledger device");
      this.notifyConnectionChange(true);
      return this.connectionState;
    } catch (error) {
      this.log("Failed to connect to Ledger device:", error);

      if (error instanceof Error) {
        if (error.message.includes("No device found")) {
          throw new DeviceNotFoundError(this.providerId);
        }
        if (error.message.includes("locked")) {
          throw new DeviceLockedError(this.providerId);
        }
        if (error.message.includes("busy")) {
          throw new DeviceBusyError(this.providerId);
        }
      }

      throw new ConnectionError(
        `Failed to connect to Ledger: ${error}`,
        this.providerId
      );
    }
  }

  async disconnect(): Promise<void> {
    this.log("Disconnecting from Ledger device...");

    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        this.log("Error closing transport:", error);
      }
      this.transport = null;
    }

    this.deviceInfo = null;
    this.currentApp = null;
    this.connectionState = null;
    this.cachedAccounts.clear();

    this.log("Disconnected from Ledger device");
    this.notifyConnectionChange(false);
  }

  async getAccounts(chainId: ChainId): Promise<SignatureProviderAccount[]> {
    this.log(`Getting accounts for chain: ${chainId}`);

    if (!this.isConnected() || !this.transport) {
      throw new ConnectionError("Ledger device not connected", this.providerId);
    }

    // Check if we have cached accounts
    const cacheKey = chainId;
    if (this.cachedAccounts.has(cacheKey)) {
      return this.cachedAccounts.get(cacheKey)!;
    }

    try {
      // Ensure correct app is open
      await this.ensureAppOpen(chainId);

      // Get accounts based on chain
      const accounts = await this.getAccountsForChain(chainId);

      // Cache the accounts
      this.cachedAccounts.set(cacheKey, accounts);

      this.log(`Found ${accounts.length} accounts for ${chainId}`);
      return accounts;
    } catch (error) {
      this.log(`Failed to get accounts for ${chainId}:`, error);

      if (error instanceof Error && error.message.includes("App not open")) {
        throw new HardwareWalletError(
          `Please open the ${this.config.requiredApps?.[chainId]} app on your Ledger device`,
          this.providerId
        );
      }

      throw error;
    }
  }

  async signTransaction(request: SignatureRequest, signal?: AbortSignalLike): Promise<SignatureResult> {
    this.log("Signing transaction:", request);

    if (!this.isConnected() || !this.transport) {
      throw new ConnectionError("Ledger device not connected", this.providerId);
    }

    const { chainId } = request.transactionData;

    try {
      // Ensure correct app is open
      await this.ensureAppOpen(chainId, signal);

      // Validate transaction
      this.validateTransaction(request.transactionData);

      // Sign based on chain
      const signature = await this.signTransactionForChain(request, signal);
      const publicKey = await this.getPublicKeyForAccount(
        request.accountAddress,
        chainId
      );

      const result: SignatureResult = {
        signature,
        publicKey,
        signedTransaction: this.buildSignedTransaction(request, signature),
        metadata: {
          ledgerProvider: true,
          chainId,
          deviceInfo: this.deviceInfo,
          signedAt: new Date().toISOString(),
        },
      };

      this.log("Transaction signed successfully");
      return result;
    } catch (error) {
      this.log("Failed to sign transaction:", error);

      if (error instanceof Error) {
        if (error.message.includes("User rejected")) {
          throw new UserRejectedError(this.providerId);
        }
        if (error.message.includes("locked")) {
          throw new DeviceLockedError(this.providerId);
        }
        if (error.message.includes("busy")) {
          throw new DeviceBusyError(this.providerId);
        }
      }

      throw new SigningError(
        `Failed to sign transaction: ${error}`,
        this.providerId,
        chainId
      );
    }
  }

  getCapabilities(): SignatureProviderCapabilities {
    return {
      supportedChains: [ChainId.BITCOIN, ChainId.STELLAR, ChainId.STARKNET],
      supportsMultipleAccounts: true,
      requiresUserInteraction: true,
      supportsMessageSigning: false, // Ledger typically doesn't support arbitrary message signing
      maxConcurrentSignatures: 1, // Hardware wallets handle one operation at a time
      metadata: {
        hardwareWallet: true,
        requiresPhysicalConfirmation: true,
        secureElement: true,
      },
    };
  }

  /**
   * Update provider configuration
   */
  updateConfig(newConfig: Partial<LedgerProviderConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): LedgerProviderConfig {
    return { ...this.config };
  }

  /**
   * Check if a specific app is currently open on the device
   */
  async isAppOpen(chainId: ChainId): Promise<boolean> {
    if (!this.transport || !this.currentApp) {
      return false;
    }

    const requiredApp = this.config.requiredApps?.[chainId];
    return this.currentApp.name === requiredApp;
  }

  private async createTransport(): Promise<LedgerTransport> {
    // In a real implementation, this would be:
    // return await TransportWebUSB.create();

    // For development, return mock transport
    return new MockLedgerTransport();
  }

  private async getDeviceInfo(): Promise<LedgerDeviceInfo> {
    // Mock device info for development
    return {
      productId: 0x0001,
      vendorId: 0x2c97,
      productName: "Ledger Nano S Plus",
      manufacturerName: "Ledger",
      serialNumber: "mock-serial-123",
    };
  }

  private async getAppInfo(): Promise<LedgerAppInfo> {
    if (!this.transport) {
      throw new Error("Transport not available");
    }

    try {
      const _response = await this.transport.send(0xb0, 0x01, 0x00, 0x00);
      void _response;

      // Parse response (mock implementation)
      return {
        name: "Dashboard",
        version: "1.0.0",
        flags: 0,
      };
    } catch (error) {
      throw new HardwareWalletError(
        `Failed to get app info: ${error}`,
        this.providerId
      );
    }
  }

  private async ensureAppOpen(chainId: ChainId, signal?: AbortSignalLike): Promise<void> {
    const requiredApp = this.config.requiredApps?.[chainId];
    if (!requiredApp) {
      throw new UnsupportedChainError(chainId, this.providerId);
    }

    if (await this.isAppOpen(chainId)) {
      return;
    }

    if (this.config.autoOpenApps) {
      // In a real implementation, this would attempt to open the app
      // For now, we'll simulate the app being opened
      this.currentApp = { name: requiredApp, version: "1.0.0", flags: 0 };
    } else {
      throw new HardwareWalletError(
        `Please open the ${requiredApp} app on your Ledger device`,
        this.providerId
      );
    }
  }

  private async getAccountsForChain(
    chainId: ChainId
  ): Promise<SignatureProviderAccount[]> {
    const derivationPath = this.config.defaultDerivationPaths?.[chainId];
    if (!derivationPath) {
      throw new UnsupportedChainError(chainId, this.providerId);
    }

    // Get public key for the derivation path
    const publicKey = await this.getPublicKey(derivationPath, chainId);
    const address = this.deriveAddressFromPublicKey(publicKey, chainId);

    return [
      {
        address,
        publicKey,
        chainId,
        derivationPath,
        metadata: {
          hardwareWallet: true,
          deviceInfo: this.deviceInfo,
        },
      },
    ];
  }

  private async getPublicKey(
    _derivationPath: string,
    _chainId: ChainId
  ): Promise<string> {
    void _derivationPath;
    void _chainId;
    if (!this.transport) {
      throw new Error("Transport not available");
    }

    try {
      // In a real implementation, this would send the appropriate APDU command
      // for the specific chain to get the public key
      const _response = await this.transport.send(0xe0, 0x02, 0x00, 0x00);
      void _response;

      // Mock public key extraction
      return "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798";
    } catch (error) {
      throw new HardwareWalletError(
        `Failed to get public key: ${error}`,
        this.providerId
      );
    }
  }

  private deriveAddressFromPublicKey(
    _publicKey: string,
    chainId: ChainId
  ): string {
    // Mock address derivation - in real implementation, this would use proper crypto
    switch (chainId) {
      case ChainId.BITCOIN:
        return "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
      case ChainId.STELLAR:
        return "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
      case ChainId.STARKNET:
        return "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
      default:
        throw new UnsupportedChainError(chainId, this.providerId);
    }
  }

  private async getPublicKeyForAccount(
    _address: string,
    chainId: ChainId
  ): Promise<string> {
    // In a real implementation, this would derive the public key for the specific account
    // For mock purposes, return a consistent public key
    return this.getPublicKey(
      this.config.defaultDerivationPaths?.[chainId] || "",
      chainId
    );
  }

  private validateTransaction(transactionData: {
    chainId: ChainId;
    transaction: unknown;
  }): void {
    const { chainId, transaction } = transactionData;

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
        throw new UnsupportedChainError(chainId, this.providerId);
    }
  }

  private validateBitcoinTransaction(tx: BitcoinTransaction): void {
    if (!tx.inputs || tx.inputs.length === 0) {
      throw new InvalidTransactionError(
        "Bitcoin transaction must have inputs",
        this.providerId,
        ChainId.BITCOIN
      );
    }
    if (!tx.outputs || tx.outputs.length === 0) {
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
    if (!tx.operations || tx.operations.length === 0) {
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

  private async signTransactionForChain(
    request: SignatureRequest,
    signal?: AbortSignalLike
  ): Promise<string> {
    if (!this.transport) {
      throw new Error("Transport not available");
    }

    const { chainId } = request.transactionData;
    void chainId;

    try {
      // In a real implementation, this would send chain-specific APDU commands
      const _response = await this.transport.send(0xe0, 0x04, 0x00, 0x00);
      void _response;

      // Extract signature from response (mock implementation)
      return "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    } catch (error) {
      if (error instanceof Error && error.message.includes("User rejected")) {
        throw new UserRejectedError(this.providerId);
      }
      throw new SigningError(
        `Failed to sign ${chainId} transaction: ${error}`,
        this.providerId,
        chainId
      );
    }
  }

  private buildSignedTransaction(
    request: SignatureRequest,
    signature: string
  ): unknown {
    const { chainId, transaction } = request.transactionData;

    switch (chainId) {
      case ChainId.BITCOIN:
        return {
          ...(transaction as BitcoinTransaction),
          signatures: [signature],
          txid: `ledger_signed_${Date.now()}`,
        };
      case ChainId.STELLAR:
        return {
          ...(transaction as StellarTransaction),
          signatures: [signature],
          hash: `ledger_hash_${Date.now()}`,
        };
      case ChainId.STARKNET:
        return {
          ...(transaction as StarknetTransaction),
          signature: [signature],
          transaction_hash: `0x${Date.now().toString(16)}`,
        };
      default:
        return {
          signature,
        };
    }
  }

  private log(message: string, data?: unknown): void {
    if (this.config.enableDebugLogging) {
      console.log(`[LedgerSignatureProvider] ${message}`, data || "");
    }
  }
}
