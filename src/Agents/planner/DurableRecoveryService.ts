import { AppDataSource } from "../../config/Datasource";
import { DurableExecution, ExecutionStatus } from "./DurableExecution.entity";
import { durableExecutor } from "./DurableExecutor";
import logger from "../../config/logger";

export class DurableRecoveryService {
  async recoverInterruptedExecutions(): Promise<void> {
    const executionRepo = AppDataSource.getRepository(DurableExecution);
    logger.info("Checking for interrupted durable executions...");
    
    const interruptedExecutions = await executionRepo.find({
      where: { status: ExecutionStatus.RUNNING },
    });

    if (interruptedExecutions.length === 0) {
      logger.info("No interrupted executions found.");
      return;
    }

    logger.info(`Found ${interruptedExecutions.length} interrupted executions. Resuming...`);

    for (const execution of interruptedExecutions) {
      try {
        // Resume in background
        durableExecutor.resumeExecution(execution.id).catch(err => {
          logger.error(`Failed to resume execution ${execution.id}`, { error: err });
        });
      } catch (error) {
        logger.error(`Failed to mark execution ${execution.id} for recovery`, { error });
      }
    }
  }
}

export const durableRecoveryService = new DurableRecoveryService();
