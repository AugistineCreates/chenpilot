import { Horizon } from "@stellar/stellar-sdk";
import config from "../../config/config";
import { HorizonSubmissionGateway } from "./HorizonSubmissionGateway";
import {
  TransactionSubmissionService,
  type TransactionSubmissionServiceOptions,
} from "./TransactionSubmission.service";
import { TypeOrmSubmissionStore } from "./TypeOrmSubmissionStore";

let instance: TransactionSubmissionService | null = null;

// Kept apart from the service so the state machine can run without Horizon
// or a database.
export function createTransactionSubmissionService(
  options: TransactionSubmissionServiceOptions = {}
): TransactionSubmissionService {
  const gateway = new HorizonSubmissionGateway(
    new Horizon.Server(config.stellar.horizonUrl),
    config.stellar.networkPassphrase
  );

  return new TransactionSubmissionService(
    gateway,
    new TypeOrmSubmissionStore(),
    options
  );
}

// Shared instance for the submission paths and the resolver job.
export function getTransactionSubmissionService(): TransactionSubmissionService {
  if (!instance) {
    instance = createTransactionSubmissionService();
  }
  return instance;
}
