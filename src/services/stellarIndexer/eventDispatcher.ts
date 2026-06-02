import { logInfo, logError, logWarn } from "../../config/logger";
import { NormalizedEvent } from "./eventNormalizer";
import { eventNormalizer } from "./eventNormalizer";

// ─── Handler contract ─────────────────────────────────────────────────────────

export interface EventHandler {
  /** Human-readable name for logging */
  name: string;
  /**
   * Return true if this handler wants to process the event.
   * Keeps routing logic out of the dispatch loop.
   */
  accepts(event: NormalizedEvent): boolean;
  /**
   * Process the event.  Must be idempotent on event.id.
   */
  handle(event: NormalizedEvent): Promise<void>;
}

// ─── Built-in handlers ────────────────────────────────────────────────────────

/**
 * Reconciliation handler – detects swap / transfer events and flags
 * discrepancies for the reconciliation pipeline.
 */
const reconciliationHandler: EventHandler = {
  name: "reconciliation",
  accepts: (e) =>
    e.type === "soroban_contract" &&
    (String(e.topics[0]).toLowerCase().includes("swap") ||
      String(e.topics[0]).toLowerCase().includes("transfer")),
  async handle(event) {
    const swap = eventNormalizer.extractSwapPayload(event);
    const transfer = eventNormalizer.extractTransferPayload(event);
    const payload = swap ?? transfer ?? event.payload;

    logInfo("[Reconciliation] event received", {
      id: event.id,
      type: event.topics[0],
      payload,
    });

    // Integration point: persist to reconciliation table / queue
    // e.g. await reconciliationRepo.upsert({ eventId: event.id, ...payload }, ['eventId']);
  },
};

/**
 * Analytics handler – fan-out to analytics store for all contract events.
 */
const analyticsHandler: EventHandler = {
  name: "analytics",
  accepts: (e) => e.type === "soroban_contract",
  async handle(event) {
    logInfo("[Analytics] recording event", {
      id: event.id,
      contractId: event.contractId,
      topic: event.topics[0],
      ledger: event.ledger,
    });

    // Integration point: write to time-series DB / analytics queue
    // e.g. await analyticsQueue.publish({ ...event, processedAt: new Date() });
  },
};

/**
 * Notification handler – triggers user-facing alerts for high-value events.
 */
const notificationHandler: EventHandler = {
  name: "notifications",
  accepts: (e) => {
    const topic = String(e.topics[0] ?? "").toLowerCase();
    return topic.includes("swap") || topic.includes("liquidat");
  },
  async handle(event) {
    logInfo("[Notifications] dispatching alert", {
      id: event.id,
      topic: event.topics[0],
      ledger: event.ledger,
    });

    // Integration point: push to notification service
    // e.g. await notificationService.send({ userId, message, event });
  },
};

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Fan-out dispatcher.  Runs all matching handlers for each event.
 * Handler failures are isolated – one failing handler does not block others.
 * Idempotency is the responsibility of each handler (keyed on event.id).
 */
export class EventDispatcher {
  private handlers: EventHandler[] = [
    reconciliationHandler,
    analyticsHandler,
    notificationHandler,
  ];

  /** Register an additional handler (e.g. from application bootstrap). */
  register(handler: EventHandler): void {
    this.handlers.push(handler);
    logInfo("[Dispatcher] handler registered", { name: handler.name });
  }

  async dispatch(events: NormalizedEvent[]): Promise<void> {
    for (const event of events) {
      await this.dispatchOne(event);
    }
  }

  private async dispatchOne(event: NormalizedEvent): Promise<void> {
    const matching = this.handlers.filter((h) => {
      try {
        return h.accepts(event);
      } catch (err) {
        logWarn("[Dispatcher] accepts() threw", { handler: h.name, err });
        return false;
      }
    });

    await Promise.allSettled(
      matching.map(async (h) => {
        try {
          await h.handle(event);
        } catch (err) {
          logError("[Dispatcher] handler error", err, {
            handler: h.name,
            eventId: event.id,
          });
        }
      })
    );
  }
}

export const eventDispatcher = new EventDispatcher();
