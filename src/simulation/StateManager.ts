import { SimulationConfig } from "./types";
import logger from "../config/logger";

export interface StateSnapshot {
  timestamp: number;
  data: Record<string, unknown>;
}

export interface StateChange {
  path: string;
  from: unknown;
  to: unknown;
}

export class StateManager {
  private config!: SimulationConfig;
  private state: Record<string, unknown> = {};
  private initialized = false;

  async initialize(config: SimulationConfig): Promise<void> {
    this.config = config;
    this.state = {}; // Initialize with default mock state if needed
    this.initialized = true;
    logger.info("State manager initialized");
  }

  updateState(path: string, value: unknown) {
    const parts = path.split(".");
    let current = this.state as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }

  createSnapshot(): StateSnapshot {
    return {
      timestamp: Date.now(),
      data: JSON.parse(JSON.stringify(this.state)),
    };
  }

  getStateChanges(beforeSnapshot: StateSnapshot): StateChange[] {
    const changes: StateChange[] = [];
    this.diffState("", beforeSnapshot.data, this.state, changes);
    return changes;
  }

  private diffState(
    path: string,
    from: unknown,
    to: unknown,
    changes: StateChange[]
  ) {
    if (from === to) return;

    if (
      typeof from !== "object" ||
      typeof to !== "object" ||
      from === null ||
      to === null
    ) {
      changes.push({ path, from, to });
      return;
    }

    const fromObj = from as Record<string, unknown>;
    const toObj = to as Record<string, unknown>;
    const keys = new Set([...Object.keys(fromObj), ...Object.keys(toObj)]);
    for (const key of keys) {
      this.diffState(
        path ? `${path}.${key}` : key,
        fromObj[key],
        toObj[key],
        changes
      );
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
