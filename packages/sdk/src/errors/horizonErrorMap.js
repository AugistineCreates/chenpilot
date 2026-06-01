"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HORIZON_ERROR_MAP = void 0;
exports.HORIZON_ERROR_MAP = {
  op_underfunded: {
    code: "OP_UNDERFUNDED",
    message:
      "The source account does not have enough balance to perform this operation.",
    action: "Ensure the account is funded or reduce the transaction amount.",
  },
  op_no_destination: {
    code: "OP_NO_DESTINATION",
    message: "The destination account does not exist.",
    action: "Ensure the recipient account has been created and funded.",
  },
  op_low_reserve: {
    code: "OP_LOW_RESERVE",
    message:
      "The account does not have enough XLM to meet the minimum reserve.",
    action: "Add more XLM to satisfy the minimum balance requirement.",
  },
  op_bad_auth: {
    code: "OP_BAD_AUTH",
    message: "The transaction is not authorized.",
    action: "Ensure the correct signer(s) have signed the transaction.",
  },
  op_not_authorized: {
    code: "OP_NOT_AUTHORIZED",
    message: "Trustline or asset authorization is missing.",
    action: "Ensure the account is authorized to hold or transact this asset.",
  },
  op_line_full: {
    code: "OP_LINE_FULL",
    message: "The trustline limit has been exceeded.",
    action: "Increase the trustline limit or reduce the transfer amount.",
  },
  tx_insufficient_fee: {
    code: "TX_INSUFFICIENT_FEE",
    message: "Transaction fee is too low.",
    action: "Increase the transaction fee.",
  },
  tx_bad_seq: {
    code: "TX_BAD_SEQ",
    message: "Invalid sequence number.",
    action: "Reload account sequence number and retry.",
  },
  tx_failed: {
    code: "TX_FAILED",
    message: "Transaction failed due to one or more operation errors.",
    action: "Inspect operation-level errors for more details.",
  },
};
