import { DataSource, LessThan, Repository } from "typeorm";
import AppDataSource from "../config/Datasource";
import logger from "../config/logger";
import { QueueJob } from "./job.entity";
import { getExecutionContext } from "../observability/context";

export interface EnqueueJobInput {
  queue: string;
  jobType: string;
  payload: Record<string, unknown>;
  userId?: string;
  correlationId?: string;
  availableAt?: Date;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
}

export interface QueueStatsRow {
  queue: string;
  jobType: string;
  status: string;
  count: number;
}

export class JobQueueService {
  constructor(private readonly dataSource: DataSource = AppDataSource) {}

  private get repository(): Repository<QueueJob> {
    return this.dataSource.getRepository(QueueJob);
  }

  async enqueue(input: EnqueueJobInput): Promise<QueueJob> {
    const job = this.repository.create({
      queue: input.queue,
      jobType: input.jobType,
      payload: input.payload,
      userId: input.userId,
      correlationId: input.correlationId,
      metadata: input.metadata,
      availableAt: input.availableAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
      status: "pending",
    });

    const saved = await this.repository.save(job);
    logger.info("Queue job enqueued", {
      jobId: saved.id,
      queue: saved.queue,
      jobType: saved.jobType,
      userId: saved.userId,
      availableAt: saved.availableAt,
    });
    return saved;
  }

  async enqueueWithContext<T extends Record<string, unknown>>(
    input: EnqueueJobInput
  ): Promise<QueueJob> {
    const context = getExecutionContext();
    return this.enqueue({
      ...input,
      correlationId: input.correlationId ?? context?.correlationId,
      metadata: {
        ...input.metadata,
        ...(context
          ? {
              requestId: context.requestId,
              executionId: context.executionId,
              rootExecutionId: context.rootExecutionId,
              parentExecutionId: context.parentExecutionId,
            }
          : {}),
      },
    });
  }

  async leaseJobs(
    queues: string[],
    workerId: string,
    leaseMs: number,
    limit = 1,
  ): Promise<QueueJob[]> {
    if (queues.length === 0 || limit <= 0) {
      return [];
    }

    const jobs = await this.dataSource.query(
      `
        WITH candidate_jobs AS (
          SELECT id
          FROM job_queue
          WHERE queue = ANY($1)
            AND "availableAt" <= NOW()
            AND (
              status = 'pending'
              OR (status = 'leased' AND "leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" < NOW())
            )
          ORDER BY "availableAt" ASC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        )
        UPDATE job_queue AS jobs
        SET status = 'leased',
            "leasedBy" = $3,
            "leaseExpiresAt" = NOW() + ($4 * INTERVAL '1 millisecond'),
            "updatedAt" = NOW()
        FROM candidate_jobs
        WHERE jobs.id = candidate_jobs.id
        RETURNING jobs.*
      `,
      [queues, limit, workerId, leaseMs],
    );

    return jobs.map((job: Record<string, unknown>) =>
      this.repository.create(job),
    );
  }

  async renewLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(QueueJob)
      .set({
        leaseExpiresAt: () => `NOW() + (${leaseMs} * INTERVAL '1 millisecond')`,
        updatedAt: () => "NOW()",
      })
      .where("id = :jobId", { jobId })
      .andWhere("status = 'leased'")
      .andWhere("leasedBy = :workerId", { workerId })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async completeJob(
    jobId: string,
    workerId: string,
    result?: Record<string, unknown>,
  ): Promise<boolean> {
    const updateResult = await this.repository
      .createQueryBuilder()
      .update(QueueJob)
      .set({
        status: "completed",
        result: result ?? null,
        completedAt: () => "NOW()",
        leaseExpiresAt: null,
        leasedBy: null,
        lastError: null,
      })
      .where("id = :jobId", { jobId })
      .andWhere("status = 'leased'")
      .andWhere("leasedBy = :workerId", { workerId })
      .execute();

    return (updateResult.affected ?? 0) > 0;
  }

  async rescheduleJob(
    jobId: string,
    workerId: string,
    availableAt: Date,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job || job.status !== "leased" || job.leasedBy !== workerId) {
      return false;
    }

    job.status = "pending";
    job.availableAt = availableAt;
    job.leaseExpiresAt = null;
    job.leasedBy = null;
    if (metadata) {
      job.metadata = metadata;
    }
    await this.repository.save(job);
    return true;
  }

  async failJob(
    job: QueueJob,
    workerId: string,
    errorMessage: string,
    retryAt: Date,
  ): Promise<"retried" | "dead_letter" | "lost_lease"> {
    const nextAttempts = job.attempts + 1;
    const shouldDeadLetter = nextAttempts >= job.maxAttempts;

    const updatePayload = shouldDeadLetter
      ? {
          status: "dead_letter" as const,
          attempts: nextAttempts,
          lastError: errorMessage,
          leaseExpiresAt: null,
          leasedBy: null,
          deadLetteredAt: () => "NOW()",
        }
      : {
          status: "pending" as const,
          attempts: nextAttempts,
          lastError: errorMessage,
          availableAt: retryAt,
          leaseExpiresAt: null,
          leasedBy: null,
        };

    const result = await this.repository
      .createQueryBuilder()
      .update(QueueJob)
      .set(updatePayload)
      .where("id = :jobId", { jobId: job.id })
      .andWhere("status = 'leased'")
      .andWhere("leasedBy = :workerId", { workerId })
      .execute();

    if ((result.affected ?? 0) === 0) {
      return "lost_lease";
    }

    return shouldDeadLetter ? "dead_letter" : "retried";
  }

  async deadLetterJob(
    jobId: string,
    workerId: string,
    errorMessage: string,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(QueueJob)
      .set({
        status: "dead_letter",
        lastError: errorMessage,
        leaseExpiresAt: null,
        leasedBy: null,
        deadLetteredAt: () => "NOW()",
      })
      .where("id = :jobId", { jobId })
      .andWhere("status = 'leased'")
      .andWhere("leasedBy = :workerId", { workerId })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async cancelJob(jobId: string, userId?: string): Promise<boolean> {
    const query = this.repository
      .createQueryBuilder()
      .update(QueueJob)
      .set({
        status: "cancelled",
        leaseExpiresAt: null,
        leasedBy: null,
      })
      .where("id = :jobId", { jobId })
      .andWhere("status IN ('pending', 'leased')");

    if (userId) {
      query.andWhere("userId = :userId", { userId });
    }

    const result = await query.execute();
    return (result.affected ?? 0) > 0;
  }

  async getJob(jobId: string): Promise<QueueJob | null> {
    return this.repository.findOne({ where: { id: jobId } });
  }

  async saveJob(job: QueueJob): Promise<QueueJob> {
    return this.repository.save(job);
  }

  async getJobsForUser(userId: string, jobType: string): Promise<QueueJob[]> {
    return this.repository.find({
      where: { userId, jobType },
      order: { createdAt: "DESC" },
    });
  }

  async getQueueStats(): Promise<QueueStatsRow[]> {
    const rows = await this.dataSource.query(
      `
        SELECT queue, "jobType", status, COUNT(*)::int AS count
        FROM job_queue
        GROUP BY queue, "jobType", status
        ORDER BY queue, "jobType", status
      `,
    );

    return rows as QueueStatsRow[];
  }

  async getDeadLetterJobs(limit = 50): Promise<QueueJob[]> {
    return this.repository.find({
      where: { status: "dead_letter" },
      order: { deadLetteredAt: "DESC" },
      take: limit,
    });
  }

  async reapCancelledOrCompletedOlderThan(cutoff: Date): Promise<number> {
    const completedResult = await this.repository.delete({
      status: "completed",
      completedAt: LessThan(cutoff),
    });
    const cancelledResult = await this.repository.delete({
      status: "cancelled",
      updatedAt: LessThan(cutoff),
    });
    const deadLetterResult = await this.repository.delete({
      status: "dead_letter",
      deadLetteredAt: LessThan(cutoff),
    });

    return (
      (completedResult.affected ?? 0) +
      (cancelledResult.affected ?? 0) +
      (deadLetterResult.affected ?? 0)
    );
  }
}

export const jobQueueService = new JobQueueService();
