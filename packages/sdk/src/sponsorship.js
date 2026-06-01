"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SponsorshipTransactionBuilder = void 0;
exports.createSponsorshipTransaction = createSponsorshipTransaction;
exports.createEndSponsorshipTransaction = createEndSponsorshipTransaction;
const StellarSdk = __importStar(require("@stellar/stellar-sdk"));
/**
 * TransactionBuilder extension with sponsorship support (SEP-40)
 *
 * SEP-40 defines a standard way for Stellar accounts to sponsor the reserve
 * for another account's ledger entries.
 */
class SponsorshipTransactionBuilder {
  /**
   * Create a new SponsorshipTransactionBuilder
   *
   * @param source - Keypair of the source account (sponsor)
   * @param networkPassphrase - Network passphrase (e.g., "Test SDF Network ; September 2015")
   * @param options - Optional builder options
   */
  constructor(source, networkPassphrase, options) {
    this.sponsorshipConfig = null;
    this.source = source;
    this.networkPassphrase = networkPassphrase;
    this.builder = new StellarSdk.TransactionBuilder({
      source: source.publicKey(),
      fee:
        (options === null || options === void 0 ? void 0 : options.fee) || 100,
      timebounds: (options === null || options === void 0
        ? void 0
        : options.timebounds) || {
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
  addBeginSponsorship(config) {
    this.sponsorshipConfig = config;
    const operation = StellarSdk.Operation.beginSponsoringFutureReserves({
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
  addEndSponsorship() {
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
  addRevokeSponsorship(entry) {
    let revokeEntry;
    if (entry.type === "ledger_key" && entry.ledgerKey) {
      revokeEntry = StellarSdk.Operation.revokeSponsorship({
        source: this.source.publicKey(),
        ledgerKey: entry.ledgerKey,
      });
    } else if (entry.type === "claimable_balance" && entry.claimableBalanceId) {
      revokeEntry = StellarSdk.Operation.revokeSponsorship({
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
  addSponsoredOperation(operation) {
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
  addSponsoredPayment(destination, asset = StellarSdk.Asset.native(), amount) {
    var _a;
    const operation = StellarSdk.Operation.payment({
      source:
        (_a = this.sponsorshipConfig) === null || _a === void 0
          ? void 0
          : _a.sponsoredAccount,
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
  addSponsoredTrustline(asset, limit) {
    var _a;
    const operation = StellarSdk.Operation.changeTrust({
      source:
        (_a = this.sponsorshipConfig) === null || _a === void 0
          ? void 0
          : _a.sponsoredAccount,
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
  addSponsoredManageData(name, value) {
    var _a;
    const operation = StellarSdk.Operation.manageData({
      source:
        (_a = this.sponsorshipConfig) === null || _a === void 0
          ? void 0
          : _a.sponsoredAccount,
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
  build() {
    return this.builder.build();
  }
  /**
   * Build and return the transaction XDR
   *
   * @returns Base64 encoded transaction envelope XDR
   */
  toXDR() {
    return this.build().toXDR();
  }
  /**
   * Set the transaction fee
   *
   * @param fee - Fee in stroops
   * @returns this builder for chaining
   */
  setFee(fee) {
    this.builder.fee = fee;
    return this;
  }
  /**
   * Set timebounds
   *
   * @param timebounds - Timebounds object
   * @returns this builder for chaining
   */
  setTimebounds(timebounds) {
    this.builder.timebounds = timebounds;
    return this;
  }
  /**
   * Set a memo for the transaction
   *
   * @param memo - Memo to add
   * @returns this builder for chaining
   */
  setMemo(memo) {
    this.builder.addMemo(memo);
    return this;
  }
  /**
   * Set a text memo
   *
   * @param text - Text for memo
   * @returns this builder for chaining
   */
  setTextMemo(text) {
    this.builder.addMemo(StellarSdk.Memo.text(text));
    return this;
  }
}
exports.SponsorshipTransactionBuilder = SponsorshipTransactionBuilder;
/**
 * Helper function to create a sponsorship transaction
 *
 * @param config - Configuration for the sponsorship
 * @returns SponsorshipResult with transaction details
 */
function createSponsorshipTransaction(
  source,
  networkPassphrase,
  sponsorshipConfig
) {
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
function createEndSponsorshipTransaction(
  source,
  networkPassphrase,
  sponsorshipConfig
) {
  const builder = new SponsorshipTransactionBuilder(source, networkPassphrase);
  // Add begin sponsorship (must be active to end)
  builder.addBeginSponsorship(sponsorshipConfig);
  // Add end sponsorship
  builder.addEndSponsorship();
  // Build transaction
  const transaction = builder.build();
  return {
    transactionXdr: transaction.toXDR(),
    operation: "end",
    sponsor: sponsorshipConfig.sponsor,
    sponsoredAccount: sponsorshipConfig.sponsoredAccount,
  };
}
