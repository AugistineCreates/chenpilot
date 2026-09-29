import logger from "../config/logger";
import { QueueJob } from "./job.entity";
import { JobQueueService, jobQueueService } from "./jobQueue.service";
import { propagateJobContext } from "../observability/jobContext";

export type JobHandlerResult =
  | { outcome: "completed"; result?: Record<string, unknown> }
  | { outcome: "retry"; delayMs?: number; error?: string }
  | { outcome: "reschedule"; availableAt: Date; metadata?: Record<string, unknown> }
  | { outcome: "dead_letter"; reason: string };

export interface JobHandler {
  jobType: string;
  handle(job: QueueJob): Promise<JobHandlerResult | void>;
}

export interface JobWorkerOptions {
  workerId: string;
  queues: string[];
  pollIntervalMs?: number;
  leaseMs?: number;
  concurrency?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NonRetryableJobError extends Error {}

export class JobWorker {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly concurrency: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private running = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly queueService: JobQueueService = jobQueueService,
    private readonly options: JobWorkerOptions,
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.leaseMs = options.leaseMs ?? 30000;
    this.concurrency = options.concurrency ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 5000;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 300000;
  }

  registerHandler(handler: JobHandler): void {
    this.handlers.set(handler.jobType, handler);
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.loops = Array.from({ length: this.concurrency }, (_, index) =>
      this.runLoop(index),
    );
    logger.info("Job worker started", {
      workerId: this.options.workerId,
      queues: this.options.queues,
      concurrency: this.concurrency,
      leaseMs: this.leaseMs,
    });
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    await Promise.all(this.loops);
    this.loops = [];
    logger.info("Job worker stopped", { workerId: this.options.workerId });
  }

  private async runLoop(slot: number): Promise<void> {
    while (this.running) {
      try {
        const [job] = await this.queueService.leaseJobs(
          this.options.queues,
          this.options.workerId,
          this.leaseMs,
          1,
        );

        if (!job) {
          await sleep(this.pollIntervalMs);
          continue;
        }

        await this.processJob(job, slot);
      } catch (error) {
        logger.error("Job worker loop failed", {
          workerId: this.options.workerId,
          slot,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(this.pollIntervalMs);
      }
    }
  }

  private async processJob(job: QueueJob, slot: number): Promise<void> {
    const handler = this.handlers.get(job.jobType);
    if (!handler) {
      await this.queueService.deadLetterJob(
        job.id,
        this.options.workerId,
        `No handler registered for ${job.jobType}`,
      );
      logger.error("Job dead-lettered without handler", {
        jobId: job.id,
        jobType: job.jobType,
      });
      return;
    }

    logger.info("Job leased", {
      jobId: job.id,
      jobType: job.jobType,
      queue: job.queue,
      slot,
      attempt: job.attempts + 1,
    });

    // ---------------------------------------------------------------------------
    // Safe-point check: re-read the job status from the database before starting
    // the handler.  This prevents invoking an irreversible side effect on a job
    // that was cancelled after it was leased but before the handler ran.
    //
    // The check window is intentionally narrow (between lease acquisition and
    // handler invocation) so that jobs already mid-handler are not interrupted —
    // handlers must manage their own internal cancellation if needed.
    // ---------------------------------------------------------------------------
    const freshJob = await this.queueService.getJob(job.id);
    if (!freshJob || freshJob.status === "cancelled") {
      logger.info("Job cancelled before handler invocation — skipping", {
        jobId: job.id,
        jobType: job.jobType,
        status: freshJob?.status ?? "not_found",
      });
      return;
    }

    const keepAlive = setInterval(() => {
      void this.queueService
        .renewLease(job.id, this.options.workerId, this.leaseMs)
        .then((renewed) => {
          if (!renewed) {
            logger.warn("Job lease renewal failed", {
              jobId: job.id,
              workerId: this.options.workerId,
            });
          }
        })
        .catch((error) => {
          logger.error("Job lease renewal error", {
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, Math.max(1000, Math.floor(this.leaseMs / 2)));

    try {
      const result = await propagateJobContext(job, async () => (await handler.handle(job)) ?? { outcome: "completed" as const });

      switch (result.outcome) {
        case "completed":
          await this.queueService.completeJob(job.id, this.options.workerId, result.result);
          logger.info("Job completed", { jobId: job.id, jobType: job.jobType });
          return;
        case "reschedule":
          await this.queueService.rescheduleJob(
            job.id,
            this.options.workerId,
            result.availableAt,
            result.metadata,
          );
          logger.info("Job rescheduled", {
            jobId: job.id,
            jobType: job.jobType,
            availableAt: result.availableAt,
          });
          return;
        case "retry": {
          const retryDelayMs = result.delayMs ?? this.computeRetryDelay(job.attempts);
          const retryAt = new Date(Date.now() + retryDelayMs);
          const retryResult = await this.queueService.failJob(
            job,
            this.options.workerId,
            result.error ?? "Handler requested retry",
            retryAt,
          );
          logger.warn("Job retry scheduled", {
            jobId: job.id,
            jobType: job.jobType,
            retryAt,
            retryResult,
          });
          return;
        }
        case "dead_letter":
          await this.queueService.deadLetterJob(
            job.id,
            this.options.workerId,
            result.reason,
          );
          logger.error("Job moved to dead letter", {
            jobId: job.id,
            jobType: job.jobType,
            reason: result.reason,
          });
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (error instanceof NonRetryableJobError) {
        await this.queueService.deadLetterJob(job.id, this.options.workerId, message);
        logger.error("Job failed permanently", {
          jobId: job.id,
          jobType: job.jobType,
          error: message,
        });
        return;
      }

      const retryAt = new Date(Date.now() + this.computeRetryDelay(job.attempts));
      const retryResult = await this.queueService.failJob(
        job,
        this.options.workerId,
        message,
        retryAt,
      );
      logger.warn("Job handler threw error", {
        jobId: job.id,
        jobType: job.jobType,
        retryResult,
        error: message,
      });
    } finally {
      clearInterval(keepAlive);
    }
  }

  private computeRetryDelay(attempts: number): number {
    const exponential = this.retryBaseDelayMs * 2 ** attempts;
    return Math.min(exponential, this.retryMaxDelayMs);
  }
}
