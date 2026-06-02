export type KycVerificationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "manual_review";

export type KycDocumentType =
  | "passport"
  | "national_id"
  | "drivers_license"
  | "proof_of_address"
  | "selfie";

export type KycAction =
  | "submit_verification"
  | "wallet.withdraw"
  | "wallet.transfer"
  | "trade.execute"
  | "agent.execute"
  | "soroban.invoke";

export interface KycDocumentInput {
  type: KycDocumentType;
  documentId?: string;
  fileUrl?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface KycPersonInput {
  userId: string;
  fullName: string;
  dateOfBirth?: string;
  email?: string;
  phoneNumber?: string;
  countryCode?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

export interface KycVerificationRequest {
  person: KycPersonInput;
  documents: KycDocumentInput[];
  referenceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface KycVerificationResult {
  provider: string;
  providerReferenceId: string;
  status: KycVerificationStatus;
  reason?: string;
  reviewedAt?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface KycGateContext {
  userId: string;
  action: KycAction;
  verificationStatus?: KycVerificationStatus;
  providerReferenceId?: string;
  metadata?: Record<string, unknown>;
}

export interface KycGateDecision {
  allowed: boolean;
  reason: string;
  requiredStatus?: KycVerificationStatus;
}

export interface KycProvider {
  readonly name: string;

  createVerification(
    request: KycVerificationRequest
  ): Promise<KycVerificationResult>;

  getVerificationStatus(
    providerReferenceId: string
  ): Promise<KycVerificationResult | null>;

  healthCheck(): Promise<boolean>;
}
