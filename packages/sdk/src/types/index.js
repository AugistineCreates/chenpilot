"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecoveryAction = exports.ChainId = void 0;
/** Supported blockchains for cross-chain operations */
var ChainId;
(function (ChainId) {
  ChainId["BITCOIN"] = "bitcoin";
  ChainId["STELLAR"] = "stellar";
  ChainId["STARKNET"] = "starknet";
})(ChainId || (exports.ChainId = ChainId = {}));
/** Recovery and cleanup actions available during cross-chain flows */
var RecoveryAction;
(function (RecoveryAction) {
  RecoveryAction["RETRY_MINT"] = "retry_mint";
  RecoveryAction["REFUND_LOCK"] = "refund_lock";
  RecoveryAction["MANUAL_INTERVENTION"] = "manual_intervention";
})(RecoveryAction || (exports.RecoveryAction = RecoveryAction = {}));
