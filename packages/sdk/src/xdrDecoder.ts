// packages/sdk/src/xdrDecoder.ts

import * as StellarSdk from "@stellar/stellar-sdk";
import { SafeXdrDecoder } from "./xdr/safeDecoder";
import { SafeXdrDecodeOptions } from "./xdr/types";
import { sanitizeDiagnostic } from "./xdr/errors";

/**
 * Utility class for decoding and explaining Stellar XDR operations in human-readable format.
 * Hardened against adversarial resource exhaustion, unbounded allocation, and payload leakage.
 */
export class XdrDecoder {
  /**
   * Explains a Stellar operation from its XDR representation in human-friendly terms.
   * @param operationXdr The XDR string or Buffer of the operation.
   * @param options Optional safe decoding limits.
   * @returns A human-readable description of the operation.
   */
  static explainOperation(
    operationXdr: string | Buffer | Uint8Array,
    options?: SafeXdrDecodeOptions
  ): string {
    try {
      const operation = SafeXdrDecoder.decodeOperation(operationXdr, options);
      const opType = operation.body().switch();
      const op = operation.body().value();

      switch (opType) {
        case StellarSdk.xdr.OperationType.createAccount(): {
          const createAccountOp = op as StellarSdk.xdr.CreateAccountOp;
          const dest = this.formatAccountId(createAccountOp.destination());
          const startingBalance = this.formatAmount(createAccountOp.startingBalance());
          return `Create account for ${dest} with starting balance of ${startingBalance} XLM`;
        }

        case StellarSdk.xdr.OperationType.payment(): {
          const paymentOp = op as StellarSdk.xdr.PaymentOp;
          const asset = paymentOp.asset();
          const assetDesc = this.getAssetDesc(asset);
          const dest = this.formatMuxedAccount(paymentOp.destination());
          const amount = this.formatAmount(paymentOp.amount());
          return `Send ${amount} ${assetDesc} to ${dest}`;
        }

        case StellarSdk.xdr.OperationType.pathPaymentStrictReceive(): {
          const pathPaymentOp = op as StellarSdk.xdr.PathPaymentStrictReceiveOp;
          const sendAsset = pathPaymentOp.sendAsset();
          const destAsset = pathPaymentOp.destAsset();
          const sendAssetDesc = this.getAssetDesc(sendAsset);
          const destAssetDesc = this.getAssetDesc(destAsset);
          const dest = this.formatMuxedAccount(pathPaymentOp.destination());
          const sendMax = this.formatAmount(pathPaymentOp.sendMax());
          const destAmount = this.formatAmount(pathPaymentOp.destAmount());
          return `Path payment: send up to ${sendMax} ${sendAssetDesc} to receive exactly ${destAmount} ${destAssetDesc} to ${dest}`;
        }

        case StellarSdk.xdr.OperationType.manageSellOffer(): {
          const manageSellOp = op as StellarSdk.xdr.ManageSellOfferOp;
          const selling = manageSellOp.selling();
          const buying = manageSellOp.buying();
          const sellingDesc = this.getAssetDesc(selling);
          const buyingDesc = this.getAssetDesc(buying);
          const amount = this.formatAmount(manageSellOp.amount());
          return `Manage sell offer: sell ${amount} ${sellingDesc} for ${buyingDesc} at price ${manageSellOp.price().n().toString()}/${manageSellOp.price().d().toString()}`;
        }

        case StellarSdk.xdr.OperationType.createPassiveSellOffer(): {
          const passiveSellOp = op as StellarSdk.xdr.CreatePassiveSellOfferOp;
          const pselling = passiveSellOp.selling();
          const pbuying = passiveSellOp.buying();
          const psellingDesc = this.getAssetDesc(pselling);
          const pbuyingDesc = this.getAssetDesc(pbuying);
          const amount = this.formatAmount(passiveSellOp.amount());
          return `Create passive sell offer: sell ${amount} ${psellingDesc} for ${pbuyingDesc} at price ${passiveSellOp.price().n().toString()}/${passiveSellOp.price().d().toString()}`;
        }

        case StellarSdk.xdr.OperationType.setOptions():
          return `Set account options`;

        case StellarSdk.xdr.OperationType.changeTrust(): {
          const changeTrustOp = op as StellarSdk.xdr.ChangeTrustOp;
          const line = changeTrustOp.line();
          const limit = this.formatAmount(changeTrustOp.limit());
          if (line.switch() === StellarSdk.xdr.AssetType.assetTypeNative()) {
            return `Change trust: remove trustline for XLM (limit: ${limit})`;
          } else {
            const assetDesc = this.getChangeTrustAssetDesc(line);
            return `Change trust: set trustline for ${assetDesc} (limit: ${limit})`;
          }
        }

        case StellarSdk.xdr.OperationType.allowTrust(): {
          const allowTrustOp = op as StellarSdk.xdr.AllowTrustOp;
          const trustor = this.formatAccountId(allowTrustOp.trustor());
          const assetCode = allowTrustOp.asset().toString();
          const authorize = allowTrustOp.authorize().toString();
          return `Allow trust: ${authorize === "1" ? "authorize" : "deauthorize"} ${trustor} to hold ${assetCode}`;
        }

        case StellarSdk.xdr.OperationType.accountMerge(): {
          const mergeOp = op as StellarSdk.xdr.MuxedAccount;
          return `Merge account into ${this.formatMuxedAccount(mergeOp)}`;
        }

        case StellarSdk.xdr.OperationType.inflation():
          return `Run inflation`;

        case StellarSdk.xdr.OperationType.manageData(): {
          const manageDataOp = op as StellarSdk.xdr.ManageDataOp;
          const name = manageDataOp.dataName().toString();
          const dataValue = manageDataOp.dataValue();
          if (dataValue) {
            return `Set account data: "${name}" = "${dataValue.toString()}"`;
          } else {
            return `Remove account data: "${name}"`;
          }
        }

        case StellarSdk.xdr.OperationType.bumpSequence(): {
          const bumpSeqOp = op as StellarSdk.xdr.BumpSequenceOp;
          return `Bump sequence number to ${bumpSeqOp.bumpTo().toString()}`;
        }

        case StellarSdk.xdr.OperationType.createClaimableBalance(): {
          const createClaimOp = op as StellarSdk.xdr.CreateClaimableBalanceOp;
          const claimants = createClaimOp.claimants();
          const asset = createClaimOp.asset();
          const amount = this.formatAmount(createClaimOp.amount());
          const assetDesc = this.getAssetDesc(asset);
          return `Create claimable balance: ${amount} ${assetDesc} for ${claimants.length} claimant(s)`;
        }

        case StellarSdk.xdr.OperationType.claimClaimableBalance(): {
          const claimOp = op as StellarSdk.xdr.ClaimClaimableBalanceOp;
          return `Claim claimable balance ${claimOp.balanceId().toString()}`;
        }

        case StellarSdk.xdr.OperationType.beginSponsoringFutureReserves(): {
          const beginSponsorOp = op as StellarSdk.xdr.BeginSponsoringFutureReservesOp;
          const sponsored = this.formatAccountId(beginSponsorOp.sponsoredId());
          return `Begin sponsoring future reserves for ${sponsored}`;
        }

        case StellarSdk.xdr.OperationType.endSponsoringFutureReserves():
          return `End sponsoring future reserves`;

        case StellarSdk.xdr.OperationType.revokeSponsorship():
          return `Revoke sponsorship`;

        case StellarSdk.xdr.OperationType.clawback(): {
          const clawbackOp = op as StellarSdk.xdr.ClawbackOp;
          const from = this.formatMuxedAccount(clawbackOp.from());
          const asset = clawbackOp.asset();
          const amount = this.formatAmount(clawbackOp.amount());
          const assetDesc = this.getAssetDesc(asset);
          return `Clawback ${amount} ${assetDesc} from ${from}`;
        }

        case StellarSdk.xdr.OperationType.clawbackClaimableBalance(): {
          const clawbackClaimOp = op as StellarSdk.xdr.ClawbackClaimableBalanceOp;
          return `Clawback claimable balance ${clawbackClaimOp.balanceId().toString()}`;
        }

        case StellarSdk.xdr.OperationType.setTrustLineFlags(): {
          const setTrustFlagsOp = op as StellarSdk.xdr.SetTrustLineFlagsOp;
          const trustor = this.formatAccountId(setTrustFlagsOp.trustor());
          const asset = setTrustFlagsOp.asset();
          const assetDesc = this.getAssetDesc(asset);
          const clearFlags = setTrustFlagsOp.clearFlags().toString();
          const setFlags = setTrustFlagsOp.setFlags().toString();
          return `Set trustline flags for ${trustor}'s ${assetDesc}: clear ${clearFlags}, set ${setFlags}`;
        }

        case StellarSdk.xdr.OperationType.liquidityPoolDeposit(): {
          const depositOp = op as StellarSdk.xdr.LiquidityPoolDepositOp;
          const poolId = depositOp.liquidityPoolId().toString();
          return `Deposit into liquidity pool ${poolId}`;
        }

        case StellarSdk.xdr.OperationType.liquidityPoolWithdraw(): {
          const withdrawOp = op as StellarSdk.xdr.LiquidityPoolWithdrawOp;
          const poolId = withdrawOp.liquidityPoolId().toString();
          return `Withdraw from liquidity pool ${poolId}`;
        }

        case StellarSdk.xdr.OperationType.invokeHostFunction():
          return `Invoke Soroban contract`;

        case StellarSdk.xdr.OperationType.extendFootprintTtl(): {
          const extendOp = op as StellarSdk.xdr.ExtendFootprintTtlOp;
          return `Extend footprint TTL by ${extendOp.extendTo().toString()} ledgers`;
        }

        case StellarSdk.xdr.OperationType.restoreFootprint():
          return `Restore footprint`;

        default:
          return `Unknown operation type: ${opType}`;
      }
    } catch (error) {
      const sanitized = sanitizeDiagnostic(
        (error as Error).message,
        options?.limits?.maxDiagnosticLength ?? 256
      );
      return `Failed to decode operation: ${sanitized}`;
    }
  }

  /**
   * Format an AccountId to Stellar G-address string.
   */
  private static formatAccountId(account: StellarSdk.xdr.AccountId): string {
    try {
      return StellarSdk.StrKey.encodeEd25519PublicKey(account.ed25519());
    } catch {
      return String(account);
    }
  }

  /**
   * Format a MuxedAccount to Stellar address string.
   */
  private static formatMuxedAccount(account: StellarSdk.xdr.MuxedAccount): string {
    try {
      return StellarSdk.encodeMuxedAccountToAddress(account, false);
    } catch {
      return String(account);
    }
  }

  /**
   * Format a stroop amount (int64 / 10,000,000) to decimal string.
   */
  private static formatAmount(amount: StellarSdk.xdr.Int64 | string | number | bigint): string {
    try {
      const raw = BigInt(amount.toString());
      const whole = raw / 10000000n;
      const rem = raw % 10000000n;
      if (rem === 0n) return whole.toString();
      const frac = rem.toString().padStart(7, "0").replace(/0+$/, "");
      return `${whole}.${frac}`;
    } catch {
      return String(amount);
    }
  }

  /**
   * Describe a payment/offer-style xdr.Asset.
   */
  private static getAssetDesc(asset: StellarSdk.xdr.Asset): string {
    if (asset.switch() === StellarSdk.xdr.AssetType.assetTypeNative()) {
      return "XLM";
    }
    if (asset.switch() === StellarSdk.xdr.AssetType.assetTypeCreditAlphanum4()) {
      const alphaNum4 = asset.alphaNum4();
      const code = alphaNum4.assetCode().toString("utf8").replace(/\0+$/, "");
      const issuer = this.formatAccountId(alphaNum4.issuer());
      return `${code} (${issuer})`;
    }
    const alphaNum12 = asset.alphaNum12();
    const code = alphaNum12.assetCode().toString("utf8").replace(/\0+$/, "");
    const issuer = this.formatAccountId(alphaNum12.issuer());
    return `${code} (${issuer})`;
  }

  /**
   * Describe xdr.ChangeTrustAsset.
   */
  private static getChangeTrustAssetDesc(
    asset: StellarSdk.xdr.ChangeTrustAsset
  ): string {
    if (asset.switch() === StellarSdk.xdr.AssetType.assetTypeCreditAlphanum4()) {
      const alphaNum4 = asset.alphaNum4();
      const code = alphaNum4.assetCode().toString("utf8").replace(/\0+$/, "");
      const issuer = this.formatAccountId(alphaNum4.issuer());
      return `${code} (${issuer})`;
    }
    if (asset.switch() === StellarSdk.xdr.AssetType.assetTypeCreditAlphanum12()) {
      const alphaNum12 = asset.alphaNum12();
      const code = alphaNum12.assetCode().toString("utf8").replace(/\0+$/, "");
      const issuer = this.formatAccountId(alphaNum12.issuer());
      return `${code} (${issuer})`;
    }
    return "liquidity pool share";
  }
}
