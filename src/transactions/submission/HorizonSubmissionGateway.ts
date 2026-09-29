import { Horizon, Transaction } from "@stellar/stellar-sdk";
import {
  AmbiguousSubmissionError,
  LedgerTransaction,
  ProviderUnavailableError,
  SubmissionGateway,
  SubmitOutcome,
} from "./SubmissionGateway";

// Result codes that prove the transaction was never applied.
// tx_bad_seq is absent on purpose: Horizon returns it both when another
// transaction took the sequence and when ours already applied.
const DEFINITIVE_REJECTION_CODES: ReadonlySet<string> = new Set([
  "tx_bad_auth",
  "tx_bad_auth_extra",
  "tx_insufficient_balance",
  "tx_insufficient_fee",
  "tx_malformed",
  "tx_missing_operation",
  "tx_no_source_account",
  "tx_not_supported",
  "tx_too_early",
  "tx_too_late",
]);

interface HorizonErrorShape {
  response?: {
    status?: number;
    data?: {
      extras?: {
        result_codes?: { transaction?: string };
        result_xdr?: string;
      };
    };
  };
}

export interface HorizonSubmissionGatewayOptions {
  /** Milliseconds before a submission is declared ambiguous. */
  submitTimeoutMs?: number;
  /** Milliseconds before a resolution query is declared unavailable. */
  queryTimeoutMs?: number;
}

const DEFAULT_SUBMIT_TIMEOUT_MS = 30_000;
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;

export class HorizonSubmissionGateway implements SubmissionGateway {
  private readonly submitTimeoutMs: number;
  private readonly queryTimeoutMs: number;

  constructor(
    private readonly server: Horizon.Server,
    private readonly networkPassphrase: string,
    options: HorizonSubmissionGatewayOptions = {}
  ) {
    this.submitTimeoutMs = options.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    this.queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  }

  async submit(envelopeXdr: string): Promise<SubmitOutcome> {
    const transaction = new Transaction(envelopeXdr, this.networkPassphrase);

    try {
      const response = await this.withTimeout(
        this.server.submitTransaction(transaction),
        this.submitTimeoutMs,
        () => new AmbiguousSubmissionError("Horizon submission timed out")
      );

      return {
        status: "applied",
        ledger: response.ledger,
        successful: response.successful !== false,
        resultXdr: response.result_xdr,
      };
    } catch (error) {
      if (error instanceof AmbiguousSubmissionError) {
        throw error;
      }
      return this.classifySubmitError(error);
    }
  }

  async findTransactionByHash(hash: string): Promise<LedgerTransaction | null> {
    try {
      const record = await this.withTimeout(
        this.server.transactions().transaction(hash).call(),
        this.queryTimeoutMs,
        () =>
          new ProviderUnavailableError("Horizon transaction lookup timed out")
      );

      return {
        hash: record.hash,
        ledger: record.ledger_attr,
        successful: record.successful,
        resultXdr: record.result_xdr,
      };
    } catch (error) {
      if (this.statusOf(error) === 404) {
        return null;
      }
      if (error instanceof ProviderUnavailableError) {
        throw error;
      }
      throw new ProviderUnavailableError(
        "Horizon transaction lookup failed",
        error
      );
    }
  }

  async getAccountSequence(accountId: string): Promise<string> {
    try {
      const account = await this.withTimeout(
        this.server.loadAccount(accountId),
        this.queryTimeoutMs,
        () => new ProviderUnavailableError("Horizon account lookup timed out")
      );
      return account.sequenceNumber();
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        throw error;
      }
      throw new ProviderUnavailableError(
        "Horizon account lookup failed",
        error
      );
    }
  }

  async getLatestLedgerCloseTime(): Promise<number> {
    try {
      const page = await this.withTimeout(
        this.server.ledgers().order("desc").limit(1).call(),
        this.queryTimeoutMs,
        () => new ProviderUnavailableError("Horizon ledger lookup timed out")
      );

      const latest = page.records[0];
      if (!latest) {
        throw new ProviderUnavailableError("Horizon returned no ledgers");
      }
      return Math.floor(new Date(latest.closed_at).getTime() / 1000);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        throw error;
      }
      throw new ProviderUnavailableError("Horizon ledger lookup failed", error);
    }
  }

  private classifySubmitError(error: unknown): SubmitOutcome {
    const status = this.statusOf(error);
    const extras = (error as HorizonErrorShape)?.response?.data?.extras;
    const code = extras?.result_codes?.transaction;

    if (status === 400 && code && DEFINITIVE_REJECTION_CODES.has(code)) {
      return {
        status: "rejected",
        reason: code,
        resultXdr: extras?.result_xdr,
      };
    }

    throw new AmbiguousSubmissionError(
      `Horizon submission returned an inconclusive error (status=${status ?? "none"}, code=${code ?? "none"})`,
      error
    );
  }

  private statusOf(error: unknown): number | undefined {
    return (error as HorizonErrorShape)?.response?.status;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    onTimeout: () => Error
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
