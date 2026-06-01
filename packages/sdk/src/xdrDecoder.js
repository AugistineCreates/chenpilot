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
exports.XdrDecoder = void 0;
const StellarSdk = __importStar(require("@stellar/stellar-sdk"));
/**
 * Utility class for decoding and explaining Stellar XDR operations in human-readable format.
 */
class XdrDecoder {
  /**
   * Explains a Stellar operation from its XDR representation in human-friendly terms.
   * @param operationXdr The XDR string of the operation.
   * @returns A human-readable description of the operation.
   */
  static explainOperation(operationXdr) {
    var _a, _b, _c, _d;
    try {
      const operation = StellarSdk.xdr.Operation.fromXDR(
        operationXdr,
        "base64"
      );
      const opType = operation.body().switch();
      const op = operation.body().value();
      switch (opType) {
        case StellarSdk.xdr.OperationType.createAccount(): {
          const createAccountOp = op;
          return `Create account for ${createAccountOp.destination().toString()} with starting balance of ${createAccountOp.startingBalance().toString()} XLM`;
        }
        case StellarSdk.xdr.OperationType.payment(): {
          const paymentOp = op;
          const asset = paymentOp.asset();
          const assetDesc = this.getAssetDesc(asset);
          return `Send ${paymentOp.amount().toString()} ${assetDesc} to ${paymentOp.destination().toString()}`;
        }
        case StellarSdk.xdr.OperationType.pathPaymentStrictReceive():
          const pathPaymentOp = op;
          const sendAsset = pathPaymentOp.sendAsset();
          const destAsset = pathPaymentOp.destAsset();
          const sendAssetDesc = this.getAssetDesc(sendAsset);
          const destAssetDesc = this.getAssetDesc(destAsset);
          return `Path payment: send up to ${pathPaymentOp.sendMax().toString()} ${sendAssetDesc} to receive exactly ${pathPaymentOp.destAmount().toString()} ${destAssetDesc} to ${pathPaymentOp.destination().toString()}`;
        case StellarSdk.xdr.OperationType.manageSellOffer():
          const manageSellOp = op;
          const selling = manageSellOp.selling();
          const buying = manageSellOp.buying();
          const sellingDesc = this.getAssetDesc(selling);
          const buyingDesc = this.getAssetDesc(buying);
          return `Manage sell offer: sell ${manageSellOp.amount().toString()} ${sellingDesc} for ${buyingDesc} at price ${manageSellOp.price().n().toString()}/${manageSellOp.price().d().toString()}`;
        case StellarSdk.xdr.OperationType.createPassiveSellOffer():
          const passiveSellOp = op;
          const pselling = passiveSellOp.selling();
          const pbuying = passiveSellOp.buying();
          const psellingDesc = this.getAssetDesc(pselling);
          const pbuyingDesc = this.getAssetDesc(pbuying);
          return `Create passive sell offer: sell ${passiveSellOp.amount().toString()} ${psellingDesc} for ${pbuyingDesc} at price ${passiveSellOp.price().n().toString()}/${passiveSellOp.price().d().toString()}`;
        case StellarSdk.xdr.OperationType.setOptions():
          return `Set account options`;
        case StellarSdk.xdr.OperationType.changeTrust():
          const changeTrustOp = op;
          const line = changeTrustOp.line();
          const limit = changeTrustOp.limit().toString();
          if (
            line.switch() ===
            ((_b =
              (_a = StellarSdk.xdr.ChangeTrustAssetType) === null ||
              _a === void 0
                ? void 0
                : _a.changeTrustAssetTypeNative) === null || _b === void 0
              ? void 0
              : _b.call(_a))
          ) {
            return `Change trust: remove trustline for XLM (limit: ${limit})`;
          } else {
            const assetDesc = this.getAssetDesc(
              ((_d = (_c = line).asset) === null || _d === void 0
                ? void 0
                : _d.call(_c)) || line
            );
            return `Change trust: set trustline for ${assetDesc} (limit: ${limit})`;
          }
        case StellarSdk.xdr.OperationType.allowTrust():
          const allowTrustOp = op;
          const trustor = allowTrustOp.trustor().toString();
          const assetCode = allowTrustOp.asset().toString();
          const authorize = allowTrustOp.authorize().toString();
          return `Allow trust: ${authorize === "1" ? "authorize" : "deauthorize"} ${trustor} to hold ${assetCode}`;
        case StellarSdk.xdr.OperationType.accountMerge():
          const mergeOp = op;
          return `Merge account into ${mergeOp.toString()}`;
        case StellarSdk.xdr.OperationType.inflation():
          return `Run inflation`;
        case StellarSdk.xdr.OperationType.manageData():
          const manageDataOp = op;
          const name = manageDataOp.dataName().toString();
          if (manageDataOp.dataValue()) {
            const value = manageDataOp.dataValue().toString();
            return `Set account data: "${name}" = "${value}"`;
          } else {
            return `Remove account data: "${name}"`;
          }
        case StellarSdk.xdr.OperationType.bumpSequence():
          const bumpSeqOp = op;
          return `Bump sequence number to ${bumpSeqOp.bumpTo().toString()}`;
        case StellarSdk.xdr.OperationType.createClaimableBalance():
          const createClaimOp = op;
          const claimants = createClaimOp.claimants();
          const asset = createClaimOp.asset();
          const amount = createClaimOp.amount().toString();
          const assetDesc = this.getAssetDesc(asset);
          return `Create claimable balance: ${amount} ${assetDesc} for ${claimants.length} claimant(s)`;
        case StellarSdk.xdr.OperationType.claimClaimableBalance():
          const claimOp = op;
          return `Claim claimable balance ${claimOp.balanceId().toString()}`;
        case StellarSdk.xdr.OperationType.beginSponsoringFutureReserves():
          const beginSponsorOp = op;
          return `Begin sponsoring future reserves for ${beginSponsorOp.sponsoredId().toString()}`;
        case StellarSdk.xdr.OperationType.endSponsoringFutureReserves():
          return `End sponsoring future reserves`;
        case StellarSdk.xdr.OperationType.revokeSponsorship():
          return `Revoke sponsorship`;
        case StellarSdk.xdr.OperationType.clawback():
          const clawbackOp = op;
          const from = clawbackOp.from().toString();
          const asset = clawbackOp.asset();
          const amount = clawbackOp.amount().toString();
          const assetDesc = this.getAssetDesc(asset);
          return `Clawback ${amount} ${assetDesc} from ${from}`;
        case StellarSdk.xdr.OperationType.clawbackClaimableBalance():
          const clawbackClaimOp = op;
          return `Clawback claimable balance ${clawbackClaimOp.balanceId().toString()}`;
        case StellarSdk.xdr.OperationType.setTrustLineFlags():
          const setTrustFlagsOp = op;
          const trustor = setTrustFlagsOp.trustor().toString();
          const asset = setTrustFlagsOp.asset();
          const assetDesc = this.getAssetDesc(asset);
          const clearFlags = setTrustFlagsOp.clearFlags().toString();
          const setFlags = setTrustFlagsOp.setFlags().toString();
          return `Set trustline flags for ${trustor}'s ${assetDesc}: clear ${clearFlags}, set ${setFlags}`;
        case StellarSdk.xdr.OperationType.liquidityPoolDeposit():
          const depositOp = op;
          const poolId = depositOp.liquidityPoolId().toString();
          return `Deposit into liquidity pool ${poolId}`;
        case StellarSdk.xdr.OperationType.liquidityPoolWithdraw():
          const withdrawOp = op;
          const poolId = withdrawOp.liquidityPoolId().toString();
          return `Withdraw from liquidity pool ${poolId}`;
        case StellarSdk.xdr.OperationType.invokeHostFunction():
          return `Invoke Soroban contract`;
        case StellarSdk.xdr.OperationType.extendFootprintTtl():
          const extendOp = op;
          return `Extend footprint TTL by ${extendOp.extendTo().toString()} ledgers`;
        case StellarSdk.xdr.OperationType.restoreFootprint():
          return `Restore footprint`;
        default:
          return `Unknown operation type: ${opType}`;
      }
    } catch (error) {
      return `Failed to decode operation: ${error.message}`;
    }
  }
  static getAssetDesc(asset) {
    if (asset.switch() === StellarSdk.xdr.AssetType.assetTypeNative()) {
      return "XLM";
    } else {
      return `${asset.assetCode().toString()} (${asset.issuer().toString()})`;
    }
  }
}
exports.XdrDecoder = XdrDecoder;
