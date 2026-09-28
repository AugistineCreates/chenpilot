export type PaymentNetwork = "stellar:testnet" | "stellar:mainnet" | string;

export interface PaymentAsset {
  code: string;
  issuer?: string;
}

export interface PaymentRequirement {
  network: PaymentNetwork;
  asset: PaymentAsset;
  amount: string;
  recipient: string;
}

export interface ChainPaymentEvent {
  id: string;
  network: PaymentNetwork;
  asset: PaymentAsset;
  amount: string;
  recipient: string;
  transactionHash: string;
  observedAt: Date;
}

export type PaymentRequestStatus =
  | "open"
  | "partially_paid"
  | "paid"
  | "overpaid"
  | "expired"
  | "cancelled";

export type PaymentRequestMatchStatus =
  | "accepted"
  | "duplicate"
  | "wrong_network"
  | "wrong_asset"
  | "wrong_recipient"
  | "closed";

export interface PaymentRequest {
  id: string;
  requirement: PaymentRequirement;
  status: PaymentRequestStatus;
  paidAmount: string;
  createdAt: Date;
  expiresAt?: Date;
  cancelledAt?: Date;
  events: ChainPaymentEvent[];
}

export interface PaymentRequestMatchResult {
  status: PaymentRequestMatchStatus;
  request: PaymentRequest;
  remainingAmount: string;
  overpaidAmount: string;
}

export interface PaymentExecution {
  idempotencyKey: string;
  requirement: PaymentRequirement;
  metadata?: Record<string, unknown>;
}

export interface PaymentExecutionResult {
  status: "success" | "failed" | "ambiguous";
  transactionHash?: string;
  error?: string;
}

export interface PaymentExecutor {
  executePayment(payment: PaymentExecution): Promise<PaymentExecutionResult>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
