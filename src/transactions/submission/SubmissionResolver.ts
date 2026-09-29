import logger from "../../config/logger";
import {
  ProviderUnavailableError,
  SubmissionGateway,
} from "./SubmissionGateway";
import { SubmissionState } from "./SubmissionState";

// What the resolver needs, without any persistence details.
export interface ResolvableSubmission {
  id: string;
  transactionHash: string;
  sourceAccount: string;
  sequenceNumber: string;
  maxTime: string | null;
}

export type SubmissionResolution =
  | {
      state: SubmissionState.FINALIZED;
      reason: string;
      ledger: number;
      resultXdr?: string;
    }
  | {
      state: SubmissionState.REJECTED;
      reason: string;
      ledger?: number;
      resultXdr?: string;
    }
  | { state: SubmissionState.EXPIRED; reason: string }
  /** Still ambiguous. Try again later. */
  | { state: SubmissionState.UNKNOWN; reason: string };

// Margin over maxTime, for ledger close jitter and indexing lag.
const EXPIRY_GRACE_SECONDS = 60;

// Resolves an unknown submission, strongest evidence first: transaction hash,
// then sequence number, then time bounds. A provider error leaves it unknown.
export class SubmissionResolver {
  constructor(private readonly gateway: SubmissionGateway) {}

  async resolve(
    submission: ResolvableSubmission
  ): Promise<SubmissionResolution> {
    try {
      const byHash = await this.gateway.findTransactionByHash(
        submission.transactionHash
      );

      if (byHash) {
        return byHash.successful
          ? {
              state: SubmissionState.FINALIZED,
              reason: "found_by_hash",
              ledger: byHash.ledger,
              resultXdr: byHash.resultXdr,
            }
          : {
              state: SubmissionState.REJECTED,
              reason: "failed_in_ledger",
              ledger: byHash.ledger,
              resultXdr: byHash.resultXdr,
            };
      }

      const accountSequence = await this.gateway.getAccountSequence(
        submission.sourceAccount
      );

      if (BigInt(accountSequence) >= BigInt(submission.sequenceNumber)) {
        // Slot taken and our hash is nowhere, so another envelope used it.
        return {
          state: SubmissionState.REJECTED,
          reason: "sequence_consumed_by_another_transaction",
        };
      }

      return this.resolveByTimeBounds(submission);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        logger.warn("Submission resolution deferred: provider unavailable", {
          submissionId: submission.id,
          transactionHash: submission.transactionHash,
          error: error.message,
        });
        return {
          state: SubmissionState.UNKNOWN,
          reason: "provider_unavailable",
        };
      }

      logger.error("Submission resolution failed", {
        submissionId: submission.id,
        transactionHash: submission.transactionHash,
        error: error instanceof Error ? error.message : String(error),
      });
      return { state: SubmissionState.UNKNOWN, reason: "resolution_error" };
    }
  }

  private async resolveByTimeBounds(
    submission: ResolvableSubmission
  ): Promise<SubmissionResolution> {
    if (!submission.maxTime || submission.maxTime === "0") {
      // No upper bound means expiry can never be proven.
      return { state: SubmissionState.UNKNOWN, reason: "no_time_bounds" };
    }

    const closeTime = await this.gateway.getLatestLedgerCloseTime();
    const maxTime = Number(submission.maxTime);

    if (closeTime > maxTime + EXPIRY_GRACE_SECONDS) {
      return { state: SubmissionState.EXPIRED, reason: "time_bounds_elapsed" };
    }

    return { state: SubmissionState.UNKNOWN, reason: "within_time_bounds" };
  }
}
