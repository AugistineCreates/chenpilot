import * as StellarSdk from "@stellar/stellar-sdk";
import { AssetToTrust, TrustlineWorkflowBuilder } from "./trustline";

export type SponsorshipOperation = "begin" | "end";

export interface SponsorshipConfig {
  sponsor: string;
  sponsoredAccount: string;
  numFrames?: number;
}

export interface SponsorshipResult {
  transactionXdr: string;
  operation: SponsorshipOperation;
  sponsor: string;
  sponsoredAccount: string;
}

export enum SponsorshipWorkflowStep {
  IDLE = "idle",
  PREVIEWING = "previewing",
  VALIDATING = "validating",
  ESTIMATING = "estimating",
  BUILDING = "building",
  READY = "ready",
}

export interface SponsorshipWorkflowConfig {
  horizonUrl?: string;
  networkPassphrase?: string;
  sponsorSecret?: string;
  sponsor?: string;
  sponsoredAccount?: string;
}

export interface SponsorshipWorkflowPreview {
  operations: any[];
  transactionXdr: string;
  sponsor: string;
  sponsoredAccount: string;
}

export interface SponsorshipWorkflowValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sponsorExists: boolean;
  sponsoredAccountExists: boolean;
}

export interface SponsorshipWorkflowResourceEstimate {
  baseFee: number;
  totalCost: string;
  operationCount: number;
  reservesToSponsor: number;
}

export interface SponsorshipWorkflowResult {
  transactionXdr: string;
  signedTransactionXdr?: string;
  operations: any[];
  resourceEstimate: SponsorshipWorkflowResourceEstimate;
}

/**
 * TransactionBuilder extension with sponsorship support (SEP-40)
 *
 * SEP-40 defines a standard way for Stellar accounts to sponsor the reserve
 * for another account's ledger entries.
 */
export class SponsorshipTransactionBuilder {
  private builder: StellarSdk.TransactionBuilder;
  private source: StellarSdk.Keypair;
  private networkPassphrase: string;
  private sponsorshipConfig: SponsorshipConfig | null = null;

  /**
   * Create a new SponsorshipTransactionBuilder
   *
   * @param source - Keypair of the source account (sponsor)
   * @param networkPassphrase - Network passphrase (e.g., "Test SDF Network ; September 2015")
   * @param options - Optional builder options
   */
  constructor(
    source: StellarSdk.Keypair,
    networkPassphrase: string,
    options?: {
      /**
       * Fee to pay for the transaction (in stroops)
       */
      fee?: number;

      /**
       * Timebounds for the transaction
       */
      timebounds?: any;
    }
  ) {
    this.source = source;
    this.networkPassphrase = networkPassphrase;

    this.builder = new (StellarSdk.TransactionBuilder as any)({
      source: source.publicKey(),
      fee: options?.fee || 100,
      timebounds: options?.timebounds || {
        minTime: Math.floor(Date.now() / 1000),
        maxTime: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      },
      networkPassphrase,
    });
  }

  /**
   * Add a "Begin Sponsoring Future Reserves" operation
   *
   * This operation designates another account as the sponsored entity.
   * After this operation succeeds, subsequent operations that add ledger entries
   * for the sponsored account will create sponsored entries.
   *
   * @param config - Sponsorship configuration
   * @returns this builder for chaining
   */
  addBeginSponsorship(config: SponsorshipConfig): this {
    this.sponsorshipConfig = config;

    const operation = (StellarSdk.Operation as any).beginSponsoringFutureReserves({
      source: config.sponsor,
      sponsored: config.sponsoredAccount,
    });

    this.builder.addOperation(operation);

    return this;
  }

  /**
   * Add an "End Sponsoring Future Reserves" operation
   *
   * This operation terminates the sponsorship relationship. The sponsored
   * account will no longer have its ledger entry fees paid by the sponsor.
   *
   * @returns this builder for chaining
   */
  addEndSponsorship(): this {
    if (!this.sponsorshipConfig) {
      throw new Error(
        "No active sponsorship to end. Call addBeginSponsorship first."
      );
    }

    const operation = StellarSdk.Operation.endSponsoringFutureReserves({
      source: this.sponsorshipConfig.sponsoredAccount,
    });

    this.builder.addOperation(operation);

    return this;
  }

  /**
   * Add a "Revoke Sponsorship" operation
   *
   * This operation removes the sponsorship from a ledger entry.
   * The entry will no longer be sponsored and the sponsor will no longer
   * pay for its ledger entry fees.
   *
   * @param entry - The ledger entry to revoke sponsorship from
   * @returns this builder for chaining
   */
  addRevokeSponsorship(entry: {
    type: "ledger_key" | "claimable_balance";
    ledgerKey?: any;
    claimableBalanceId?: string;
  }): this {
    let revokeEntry: any;

    if (entry.type === "ledger_key" && entry.ledgerKey) {
      revokeEntry = (StellarSdk.Operation as any).revokeSponsorship({
        source: this.source.publicKey(),
        ledgerKey: entry.ledgerKey,
      });
    } else if (entry.type === "claimable_balance" && entry.claimableBalanceId) {
      revokeEntry = (StellarSdk.Operation as any).revokeSponsorship({
        source: this.source.publicKey(),
        claimableBalanceId: entry.claimableBalanceId,
      });
    } else {
      throw new Error("Invalid sponsorship revocation entry");
    }

    this.builder.addOperation(revokeEntry);

    return this;
  }

  /**
   * Add any operation while in a sponsorship context
   *
   * This is useful when you want to add operations that should be sponsored.
   * For example, creating trustlines or managing data while sponsoring an account.
   *
   * @param operation - The operation to add
   * @returns this builder for chaining
   */
  addSponsoredOperation(operation: any): this {
    this.builder.addOperation(operation);

    return this;
  }

  /**
   * Add a payment operation that will be sponsored
   *
   * @param destination - Destination account address
   * @param asset - Asset to send (default: XLM)
   * @param amount - Amount to send
   * @returns this builder for chaining
   */
  addSponsoredPayment(
    destination: string,
    asset: StellarSdk.Asset = StellarSdk.Asset.native(),
    amount: string
  ): this {
    const operation = StellarSdk.Operation.payment({
      source: this.sponsorshipConfig?.sponsoredAccount,
      destination,
      asset,
      amount,
    });

    this.builder.addOperation(operation);

    return this;
  }

  /**
   * Add a trustline operation that will be sponsored
   *
   * @param asset - The asset to trust
   * @param limit - Optional trust limit
   * @returns this builder for chaining
   */
  addSponsoredTrustline(asset: StellarSdk.Asset, limit?: string): this {
    const operation = StellarSdk.Operation.changeTrust({
      source: this.sponsorshipConfig?.sponsoredAccount,
      asset,
      limit,
    });

    this.builder.addOperation(operation);

    return this;
  }

  /**
   * Add a manage data operation that will be sponsored
   *
   * @param name - Data entry name
   * @param value - Data entry value
   * @returns this builder for chaining
   */
  addSponsoredManageData(name: string, value: string | null): this {
    const operation = StellarSdk.Operation.manageData({
      source: this.sponsorshipConfig?.sponsoredAccount,
      name,
      value,
    });

    this.builder.addOperation(operation);

    return this;
  }

  /**
   * Build the transaction
   *
   * @returns The built transaction
   */
  build(): StellarSdk.Transaction {
    return this.builder.build();
  }

  /**
   * Build and return the transaction XDR
   *
   * @returns Base64 encoded transaction envelope XDR
   */
  toXDR(): string {
    return this.build().toXDR();
  }

  /**
   * Set the transaction fee
   *
   * @param fee - Fee in stroops
   * @returns this builder for chaining
   */
  setFee(fee: number): this {
    (this.builder as any).fee = fee;
    return this;
  }

  /**
   * Set timebounds
   *
   * @param timebounds - Timebounds object
   * @returns this builder for chaining
   */
  setTimebounds(timebounds: any): this {
    (this.builder as any).timebounds = timebounds;
    return this;
  }

  /**
   * Set a memo for the transaction
   *
   * @param memo - Memo to add
   * @returns this builder for chaining
   */
  setMemo(memo: StellarSdk.Memo): this {
    this.builder.addMemo(memo);
    return this;
  }

  /**
   * Set a text memo
   *
   * @param text - Text for memo
   * @returns this builder for chaining
   */
  setTextMemo(text: string): this {
    this.builder.addMemo(StellarSdk.Memo.text(text));
    return this;
  }
}

/**
 * Helper function to create a sponsorship transaction
 *
 * @param config - Configuration for the sponsorship
 * @returns SponsorshipResult with transaction details
 */
export function createSponsorshipTransaction(
  source: StellarSdk.Keypair,
  networkPassphrase: string,
  sponsorshipConfig: SponsorshipConfig
): SponsorshipResult {
  const builder = new SponsorshipTransactionBuilder(source, networkPassphrase);

  // Add begin sponsorship
  builder.addBeginSponsorship(sponsorshipConfig);

  // Build transaction
  const transaction = builder.build();

  return {
    transactionXdr: transaction.toXDR(),
    operation: "begin",
    sponsor: sponsorshipConfig.sponsor,
    sponsoredAccount: sponsorshipConfig.sponsoredAccount,
  };
}

/**
 * Helper function to create an end sponsorship transaction
 *
 * @param source - Keypair of the source account
 * @param networkPassphrase - Network passphrase
 * @param sponsorshipConfig - Original sponsorship configuration
 * @returns SponsorshipResult with transaction details
 */
export function createEndSponsorshipTransaction(
  source: StellarSdk.Keypair,
  networkPassphrase: string,
  sponsorshipConfig: SponsorshipConfig
): SponsorshipResult {
  const builder = new SponsorshipTransactionBuilder(source, networkPassphrase);

  builder.addBeginSponsorship(sponsorshipConfig);
  builder.addEndSponsorship();

  const transaction = builder.build();

  return {
    transactionXdr: transaction.toXDR(),
    operation: "end",
    sponsor: sponsorshipConfig.sponsor,
    sponsoredAccount: sponsorshipConfig.sponsoredAccount,
  };
}

export class SponsorshipWorkflowBuilder {
  private config: Required<SponsorshipWorkflowConfig>;
  private sponsoredAssets: AssetToTrust[] = [];
  private managedData: Array<{ name: string; value: string | null }> = [];
  private createAccountDestination?: string;
  private payments: Array<{ destination: string; amount: string; asset?: StellarSdk.Asset }> = [];
  private step: SponsorshipWorkflowStep = SponsorshipWorkflowStep.IDLE;

  constructor(config: SponsorshipWorkflowConfig = {}) {
    this.config = {
      horizonUrl: config.horizonUrl || "https://horizon.stellar.org",
      networkPassphrase: config.networkPassphrase || StellarSdk.Networks.PUBLIC,
      sponsorSecret: config.sponsorSecret ?? "",
      sponsor: config.sponsor ?? "",
      sponsoredAccount: config.sponsoredAccount ?? "",
    };
  }

  setSponsoredAccount(accountId: string): this {
    this.config.sponsoredAccount = accountId;
    this.step = SponsorshipWorkflowStep.BUILDING;
    return this;
  }

  addTrustline(assetCode: string, assetIssuer: string, limit?: string): this {
    this.sponsoredAssets.push({ assetCode, assetIssuer, limit });
    this.step = SponsorshipWorkflowStep.BUILDING;
    return this;
  }

  addTrustlines(assets: AssetToTrust[]): this {
    this.sponsoredAssets.push(...assets);
    this.step = SponsorshipWorkflowStep.BUILDING;
    return this;
  }

  addCreateAccount(destination: string, startingBalance: string = "0"): this {
    this.createAccountDestination = destination;
    this.step = SponsorshipWorkflowStep.BUILDING;
    return this;
  }

  addManageData(name: string, value: string | null): this {
    this.managedData.push({ name, value });
    this.step = SponsorshipWorkflowStep.BUILDING;
    return this;
  }

  addPayment(destination: string, amount: string, asset?: StellarSdk.Asset): this {
    this.payments.push({ destination, amount, asset });
    this.step = SponsorshipWorkflowStep.BUILDING;
    return this;
  }

  async preview(): Promise<SponsorshipWorkflowPreview> {
    this.step = SponsorshipWorkflowStep.PREVIEWING;

    const operations: any[] = [];

    if (this.config.sponsor && this.config.sponsoredAccount) {
      operations.push(
        (StellarSdk.Operation as any).beginSponsoringFutureReserves({
          sponsor: this.config.sponsor,
          sponsored: this.config.sponsoredAccount,
        })
      );
    }

    for (const asset of this.sponsoredAssets) {
      operations.push(
        StellarSdk.Operation.changeTrust({
          source: this.config.sponsoredAccount,
          asset: new StellarSdk.Asset(asset.assetCode, asset.assetIssuer),
          limit: asset.limit,
        })
      );
    }

    for (const data of this.managedData) {
      operations.push(
        StellarSdk.Operation.manageData({
          source: this.config.sponsoredAccount,
          name: data.name,
          value: data.value,
        })
      );
    }

    for (const payment of this.payments) {
      operations.push(
        StellarSdk.Operation.payment({
          source: this.config.sponsoredAccount,
          destination: payment.destination,
          asset: payment.asset || StellarSdk.Asset.native(),
          amount: payment.amount,
        })
      );
    }

    if (this.createAccountDestination && this.config.sponsor) {
      operations.push(
        StellarSdk.Operation.createAccount({
          source: this.config.sponsor,
          destination: this.createAccountDestination,
          startingBalance: "0",
        })
      );
    }

    if (this.config.sponsoredAccount) {
      operations.push(
        StellarSdk.Operation.endSponsoringFutureReserves({
          source: this.config.sponsoredAccount,
        })
      );
    }

    let transactionXdr = "";
    if (this.config.sponsor) {
      const tx = new StellarSdk.TransactionBuilder(
        new StellarSdk.Account(this.config.sponsor, "0"),
        {
          fee: StellarSdk.BASE_FEE,
          networkPassphrase: this.config.networkPassphrase,
        }
      );
      operations.forEach((op) => tx.addOperation(op));
      transactionXdr = tx.build().toXDR();
    }

    return {
      operations,
      transactionXdr,
      sponsor: this.config.sponsor || "",
      sponsoredAccount: this.config.sponsoredAccount || "",
    };
  }

  async validate(): Promise<SponsorshipWorkflowValidation> {
    this.step = SponsorshipWorkflowStep.VALIDATING;

    const errors: string[] = [];
    const warnings: string[] = [];
    let sponsorExists = false;
    let sponsoredAccountExists = false;

    if (!this.config.sponsor) {
      errors.push("Sponsor account is required");
    }

    if (!this.config.sponsoredAccount) {
      errors.push("Sponsored account is required");
    }

    const server = new StellarSdk.Horizon.Server(this.config.horizonUrl);

    if (this.config.sponsor) {
      try {
        await server.accounts().accountId(this.config.sponsor).call();
        sponsorExists = true;
      } catch {
        errors.push(`Sponsor account ${this.config.sponsor} not found`);
      }
    }

    if (this.config.sponsoredAccount && !this.createAccountDestination) {
      try {
        await server.accounts().accountId(this.config.sponsoredAccount).call();
        sponsoredAccountExists = true;
      } catch {
        warnings.push(`Sponsored account ${this.config.sponsoredAccount} does not exist yet`);
      }
    }

    this.sponsoredAssets.forEach((a) => {
      if (!a.assetIssuer.startsWith("G")) {
        warnings.push(`Asset issuer ${a.assetIssuer} does not appear to be a valid Stellar address`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sponsorExists,
      sponsoredAccountExists,
    };
  }

  estimate(previewResult?: SponsorshipWorkflowPreview): SponsorshipWorkflowResourceEstimate {
    this.step = SponsorshipWorkflowStep.ESTIMATING;

    const preview = previewResult || { operations: [] };
    const operationCount = preview.operations.length;
    const reservesToSponsor = this.sponsoredAssets.length + this.managedData.length + (this.createAccountDestination ? 1 : 0);

    return {
      baseFee: 100,
      totalCost: operationCount.toString(),
      operationCount,
      reservesToSponsor,
    };
  }

  async build(): Promise<SponsorshipWorkflowResult> {
    const preview = await this.preview();
    const estimate = this.estimate(preview);

    return {
      transactionXdr: preview.transactionXdr,
      operations: preview.operations,
      resourceEstimate: estimate,
    };
  }

  getCurrentStep(): SponsorshipWorkflowStep {
    return this.step;
  }
}

export function withSponsorship(
  trustlineWorkflow: TrustlineWorkflowBuilder,
  sponsorshipConfig: SponsorshipWorkflowConfig
): SponsorshipWorkflowBuilder {
  const builder = new SponsorshipWorkflowBuilder(sponsorshipConfig);

  const assets = (trustlineWorkflow as any).assets || [];
  assets.forEach((asset: AssetToTrust) => {
    builder.addTrustline(asset.assetCode, asset.assetIssuer, asset.limit);
  });

  const trustlinesToRemove = (trustlineWorkflow as any).trustlinesToRemove || [];
  trustlinesToRemove.forEach((t: { assetCode: string; assetIssuer: string }) => {
    builder.addTrustline(t.assetCode, t.assetIssuer);
  });

  return builder;
}
