export type HorizonResultCode =
  | "op_underfunded"
  | "op_no_destination"
  | "op_low_reserve"
  | "op_bad_auth"
  | "op_not_authorized"
  | "op_line_full"
  | "tx_insufficient_fee"
  | "tx_bad_seq"
  | "tx_failed"
  | string; // fallback for unknown

export interface StellarErrorDetails {
  code: string;
  message: string;
  action?: string;
  rawCode?: HorizonResultCode;
}
