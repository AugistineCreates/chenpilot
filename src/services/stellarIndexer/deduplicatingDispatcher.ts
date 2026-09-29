import { NormalizedEvent } from "./eventNormalizer";
import { EventDispatcher, EventHandler } from "./eventDispatcher";
import { logInfo, logWarn } from "../../config/logger";

/**
 * Deduplicating Event Dispatcher (Issue #750 - Acceptance Criterion 3).
 * Ensures that replay, backfill, and multi-provider failover NEVER trigger
 * duplicate side effects for already-processed events.
 */
export class DeduplicatingDispatcher {
  private processedEventIds = new Set<string>();
  private executedSideEffectsCount = 0;
  private deduplicatedCount = 0;
  private customHandlers: EventHandler[] = [];

  constructor(private readonly fallbackDispatcher?: EventDispatcher) {}

  registerHandler(handler: EventHandler): void {
    this.customHandlers.push(handler);
  }

  /**
   * Dispatches events, filtering out any event ID that has already been dispatched.
   */
  async dispatch(events: NormalizedEvent[]): Promise<{
    dispatchedCount: number;
    deduplicatedCount: number;
  }> {
    let dispatched = 0;
    let deduplicated = 0;

    for (const event of events) {
      if (this.processedEventIds.has(event.id)) {
        deduplicated++;
        this.deduplicatedCount++;
        logInfo("[DeduplicatingDispatcher] Skipped duplicate event (side-effect prevented)", {
          eventId: event.id,
          ledger: event.ledger,
        });
        continue;
      }

      // Mark event as processed before executing side effects
      this.processedEventIds.add(event.id);
      dispatched++;
      this.executedSideEffectsCount++;

      // Execute custom handlers
      for (const handler of this.customHandlers) {
        if (handler.accepts(event)) {
          try {
            await handler.handle(event);
          } catch (err) {
            logWarn("[DeduplicatingDispatcher] Handler error", {
              handler: handler.name,
              eventId: event.id,
              err,
            });
          }
        }
      }

      // Also forward to fallback dispatcher if provided
      if (this.fallbackDispatcher) {
        await this.fallbackDispatcher.dispatch([event]);
      }
    }

    return { dispatchedCount: dispatched, deduplicatedCount: deduplicated };
  }

  isProcessed(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  getMetrics(): { processedCount: number; deduplicatedCount: number } {
    return {
      processedCount: this.executedSideEffectsCount,
      deduplicatedCount: this.deduplicatedCount,
    };
  }

  clearProcessedCache(): void {
    this.processedEventIds.clear();
    this.executedSideEffectsCount = 0;
    this.deduplicatedCount = 0;
  }
}

export const deduplicatingDispatcher = new DeduplicatingDispatcher();
