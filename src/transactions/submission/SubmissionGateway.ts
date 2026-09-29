// Provider contract. Implementations return a SubmitOutcome only for applied
// or provably invalid transactions; everything else is ambiguous and must
// throw AmbiguousSubmissionError.

export interface LedgerTransaction {
  hash: string;
  ledger: number;
  successful: boolean;
  resultXdr?: string;
}

export type SubmitOutcome =
  | {
      status: "applied";
      ledger: number;
      successful: boolean;
      resultXdr?: string;
    }
  | { status: "accepted" }
  | { status: "rejected"; reason: string; resultXdr?: string };

export interface SubmissionGateway {
  /** @throws AmbiguousSubmissionError when the outcome cannot be determined. */
  submit(envelopeXdr: string): Promise<SubmitOutcome>;

  /** Null when the provider has no record of the hash. */
  findTransactionByHash(hash: string): Promise<LedgerTransaction | null>;

  /** Current sequence number of the account, as an int64 string. */
  getAccountSequence(accountId: string): Promise<string>;

  /** Unix seconds. Time bounds are validated against this, not the local clock. */
  getLatestLedgerCloseTime(): Promise<number>;
}

// The submission may or may not have reached the network.
export class AmbiguousSubmissionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "AmbiguousSubmissionError";
  }
}

// The provider could not answer. Says nothing about the transaction.
export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}
