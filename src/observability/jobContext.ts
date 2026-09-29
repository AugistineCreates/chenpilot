import { QueueJob } from "../jobs/job.entity";
import { ExecutionContext, getExecutionContext, runWithExecutionContext } from "../observability/context";

export function createJobContext(job: QueueJob): ExecutionContext {
  const current = getExecutionContext();
  const metadata = job.metadata || {};

  return {
    requestId: current?.requestId || (metadata.requestId as string | undefined) || job.correlationId || undefined,
    executionId: current?.executionId || job.id,
    rootExecutionId: current?.rootExecutionId || (metadata.rootExecutionId as string | undefined) || job.correlationId || job.id,
    parentExecutionId: current?.parentExecutionId || (metadata.parentExecutionId as string | undefined),
    userId: job.userId || undefined,
    transport: "queue",
    queueName: job.queue,
    jobId: job.id,
    component: "queue",
  };
}

export function propagateJobContext<T>(
  job: QueueJob,
  callback: () => T
): T {
  const context = createJobContext(job);
  return runWithExecutionContext(context, callback);
}
