import * as StellarSdk from "@stellar/stellar-sdk";
import { Repository } from "typeorm";
import { User } from "../Auth/user.entity";
import config from "../config/config";
import AppDataSource from "../config/Datasource";
import logger from "../config/logger";
import { DeploymentEventBridge, TransactionEventBridge } from "../Gateway/eventBridges";
import { JobHandler, JobHandlerResult, NonRetryableJobError } from "./jobWorker";
import { getFinalizationManager } from "../services/finality/FinalizationManager";
import { SafeXdrDecoder } from "../utils/xdr";


interface DelayedTransactionPayload {
  userId: string;
  transactionXdr: string;
  config: {
    strategy: "scheduled" | "fee_based" | "congestion_based";
    scheduledAt?: number;
    maxFee?: number;
    targetFee?: number;
    maxRetries?: number;
    retryDelay?: number;
  };
}

interface FundingAutoDeployPayload {
  userId: string;
  transactionHash: string;
  amount: string;
  stellarAccount: string;
}

class DelayedTransactionJobHandler implements JobHandler {
  readonly jobType = "delayed_transaction.submit";
  private readonly server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
  private lastFeeCheck?: { fee: number; checkedAt: number };
  private readonly feeCacheTtlMs = 60000;
  private readonly defaultRetryDelayMs = 30000;

  async handle(job: QueueJob): Promise<JobHandlerResult> {
    const payload = job.payload as unknown as DelayedTransactionPayload;
    const { transactionXdr, userId } = payload;

    if (!transactionXdr || !payload.config?.strategy) {
      throw new NonRetryableJobError("Delayed transaction payload is incomplete");
    }

    const readinessDelayMs = await this.getReadinessDelayMs(payload);
    if (readinessDelayMs > 0) {
      return {
        outcome: "reschedule",
        availableAt: new Date(Date.now() + readinessDelayMs),
        metadata: {
          ...(job.metadata ?? {}),
          lastDeferredAt: new Date().toISOString(),
          deferredReason: payload.config.strategy,
        },
      };
    }

    try {
      const tx = SafeXdrDecoder.decodeTransaction(
        transactionXdr,
        { networkPassphrase: config.stellar.networkPassphrase }
      ) as StellarSdk.Transaction;
      const response = await this.server.submitTransaction(tx);

      // Instead of immediately calling notifyConfirmed, start reorg-aware finality tracking
      // The finalization manager will emit finality:declared event when finality is reached
      const finalizationManager = getFinalizationManager();
      
      // Start finality tracking (does NOT yet trigger balance updates or downstream events)
      await finalizationManager.startTracking(
        job.id,
        response.hash,
        response.ledger,
        response.ledger_attr?.hash || "",
        config.stellar.horizonUrl
      );

      // Wire up finality listener for this transaction to trigger side effects when FINAL
      const onFinalityDeclared = (data: any) => {
        if (data.transactionId === job.id) {
          // NOW trigger balance updates and downstream events (only when truly final)
          TransactionEventBridge.notifyTransactionConfirmed(
            job.id,
            response.hash,
            undefined,
            undefined,
            userId,
          );
          finalizationManager.removeListener("finality:declared", onFinalityDeclared);
        }
      };

      finalizationManager.once("finality:declared", onFinalityDeclared);

      return {
        outcome: "completed",
        result: {
          txHash: response.hash,
          submittedAt: new Date().toISOString(),
          finalityTracking: true,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown transaction submission error";

      TransactionEventBridge.notifyTransactionFailed(
        job.id,
        job.id,
        errorMessage,
        userId,
      );


      return {
        outcome: "retry",
        delayMs: payload.config.retryDelay ?? this.defaultRetryDelayMs,
        error: errorMessage,
      };
    }
  }

  private async getReadinessDelayMs(
    payload: DelayedTransactionPayload,
  ): Promise<number> {
    switch (payload.config.strategy) {
      case "scheduled": {
        const scheduledAt = payload.config.scheduledAt;
        if (!scheduledAt) {
          throw new NonRetryableJobError("Scheduled delayed transaction is missing scheduledAt");
        }
        return Math.max(0, scheduledAt - Date.now());
      }
      case "fee_based": {
        const feeInfo = await this.getCurrentFee();
        const maxFee = payload.config.maxFee ?? 100000;
        return feeInfo.fee <= maxFee ? 0 : this.defaultRetryDelayMs;
      }
      case "congestion_based": {
        const feeInfo = await this.getCurrentFee();
        return feeInfo.fee <= 10000 ? 0 : this.defaultRetryDelayMs;
      }
      default:
        throw new NonRetryableJobError("Unsupported delayed transaction strategy");
    }
  }

  private async getCurrentFee(): Promise<{ fee: number; checkedAt: number }> {
    if (
      this.lastFeeCheck &&
      Date.now() - this.lastFeeCheck.checkedAt < this.feeCacheTtlMs
    ) {
      return this.lastFeeCheck;
    }

    const response = await this.server.feeStats().call();
    this.lastFeeCheck = {
      fee: response.fee_charged.max_fee || 100,
      checkedAt: Date.now(),
    };
    return this.lastFeeCheck;
  }
}

class FundingAutoDeploymentJobHandler implements JobHandler {
  readonly jobType = "funding.auto_deploy";
  private readonly userRepository: Repository<User>;

  constructor() {
    this.userRepository = AppDataSource.getRepository(User);
  }

  async handle(job: QueueJob): Promise<JobHandlerResult> {
    const payload = job.payload as unknown as FundingAutoDeployPayload;
    if (!payload.userId) {
      throw new NonRetryableJobError("Funding auto-deploy payload is missing userId");
    }

    const user = await this.userRepository.findOne({ where: { id: payload.userId } });
    if (!user) {
      throw new NonRetryableJobError(`User ${payload.userId} not found for auto-deploy`);
    }

    if (user.isDeployed) {
      return {
        outcome: "completed",
        result: { deployed: true, alreadyDeployed: true },
      };
    }

    DeploymentEventBridge.notifyDeploymentStatus(
      `deploy-${payload.userId}`,
      "in-progress",
      "Queued deployment started",
      payload.userId,
      25,
      { transactionHash: payload.transactionHash },
    );

    user.isDeployed = true;
    user.updatedAt = new Date();
    await this.userRepository.save(user);

    DeploymentEventBridge.notifyDeploymentStatus(
      `deploy-${payload.userId}`,
      "completed",
      "Queued deployment completed",
      payload.userId,
      100,
      {
        transactionHash: payload.transactionHash,
        amount: payload.amount,
        stellarAccount: payload.stellarAccount,
      },
    );

    logger.info("Funding auto-deployment completed", {
      userId: payload.userId,
      jobId: job.id,
      transactionHash: payload.transactionHash,
    });

    return {
      outcome: "completed",
      result: {
        deployed: true,
        transactionHash: payload.transactionHash,
      },
    };
  }
}

export function buildDefaultJobHandlers(): JobHandler[] {
  return [
    new DelayedTransactionJobHandler(),
    new FundingAutoDeploymentJobHandler(),
  ];
}
