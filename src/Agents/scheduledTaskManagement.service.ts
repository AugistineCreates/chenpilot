export type ScheduledTaskStatus = "active" | "paused" | "cancelled";
export type MissedWindowBehavior = "skip" | "run_on_recovery" | "require_reapproval";

export interface ScheduledAgentTask {
  id: string;
  originatingIdentity: string;
  payload: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
  approvalPolicy: "low_risk_auto" | "require_approval" | "high_risk";
  missedWindowBehavior: MissedWindowBehavior;
  status: ScheduledTaskStatus;
  materialRevision: number;
  lastRunKey?: string;
  runHistory: Array<{ runKey: string; status: "completed" | "failed" | "skipped" | "blocked"; reason?: string }>;
}

export interface ScheduledTaskAuthorization {
  authorize(task: ScheduledAgentTask): Promise<boolean>;
}

export class ScheduledTaskManagementService {
  private readonly tasks = new Map<string, ScheduledAgentTask>();

  create(task: Omit<ScheduledAgentTask, "status" | "materialRevision" | "runHistory">): ScheduledAgentTask {
    if (task.windowEnd <= task.windowStart) {
      throw new Error("Execution window end must be after start");
    }
    const created: ScheduledAgentTask = { ...task, status: "active", materialRevision: 0, runHistory: [] };
    this.tasks.set(task.id, created);
    return this.snapshot(created);
  }

  update(id: string, changes: Partial<Pick<ScheduledAgentTask, "payload" | "windowStart" | "windowEnd" | "approvalPolicy">>, approved = false): ScheduledAgentTask {
    const task = this.mustGet(id);
    const material = Boolean(changes.payload || changes.windowStart || changes.windowEnd || changes.approvalPolicy);
    if (material && !approved) {
      throw new Error("Material scheduled task revisions require approval");
    }
    Object.assign(task, changes);
    if (material) task.materialRevision += 1;
    return this.snapshot(task);
  }

  pause(id: string): ScheduledAgentTask {
    const task = this.mustGet(id);
    task.status = "paused";
    return this.snapshot(task);
  }

  cancel(id: string): ScheduledAgentTask {
    const task = this.mustGet(id);
    task.status = "cancelled";
    return this.snapshot(task);
  }

  async runDue(id: string, now: Date, authorization: ScheduledTaskAuthorization, executor: (task: ScheduledAgentTask) => Promise<void>): Promise<ScheduledAgentTask> {
    const task = this.mustGet(id);
    const runKey = `${task.id}:${task.windowStart.toISOString()}:${task.materialRevision}`;
    if (task.lastRunKey === runKey) {
      return this.record(task, runKey, "skipped", "duplicate run prevented");
    }
    if (task.status !== "active") {
      return this.record(task, runKey, "skipped", `task is ${task.status}`);
    }
    if (now < task.windowStart) {
      return this.record(task, runKey, "skipped", "execution window has not opened");
    }
    if (now > task.windowEnd) {
      if (task.missedWindowBehavior === "run_on_recovery") {
        // continue
      } else {
        const reason = task.missedWindowBehavior === "require_reapproval" ? "missed window requires reapproval" : "execution window missed";
        return this.record(task, runKey, "blocked", reason);
      }
    }
    if (task.approvalPolicy === "high_risk" || !(await authorization.authorize(task))) {
      return this.record(task, runKey, "blocked", "runtime authorization required");
    }

    try {
      await executor(this.snapshot(task));
      task.lastRunKey = runKey;
      return this.record(task, runKey, "completed");
    } catch (error) {
      return this.record(task, runKey, "failed", error instanceof Error ? error.message : "execution failed");
    }
  }

  get(id: string): ScheduledAgentTask {
    return this.snapshot(this.mustGet(id));
  }

  private record(task: ScheduledAgentTask, runKey: string, status: "completed" | "failed" | "skipped" | "blocked", reason?: string): ScheduledAgentTask {
    task.runHistory.push({ runKey, status, reason });
    return this.snapshot(task);
  }

  private mustGet(id: string): ScheduledAgentTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Unknown scheduled task: ${id}`);
    return task;
  }

  private snapshot(task: ScheduledAgentTask): ScheduledAgentTask {
    return { ...task, windowStart: new Date(task.windowStart), windowEnd: new Date(task.windowEnd), payload: { ...task.payload }, runHistory: task.runHistory.map((run) => ({ ...run })) };
  }
}
