import type { Socket } from "socket.io";

/**
 * Delivery class for a realtime event, deciding how it behaves under
 * backpressure from a non-reading ("slow") consumer.
 */
export enum DeliveryClass {
  /**
   * Must not be silently dropped: terminal state changes and alerts. Critical
   * events are queued up to a hard per-socket bound; a socket that exceeds the
   * bound is treated as a slow consumer and evicted.
   */
  Critical = "critical",
  /**
   * Safe to drop under backpressure: high-frequency progress/status updates
   * whose latest value is superseded. Sent with `volatile` so the transport
   * discards them instead of buffering when the client cannot keep up.
   */
  Lossy = "lossy",
}

export interface FlowControlOptions {
  /**
   * Maximum number of critical events buffered for a single non-reading socket
   * before it is evicted. Bounds per-socket memory under stalled consumers.
   */
  maxBufferedEventsPerSocket?: number;
}

export interface FlowControlStats {
  /** Critical events dropped because their socket was evicted. */
  evicted: number;
  /** Lossy events dropped under backpressure. */
  dropped: number;
}

/** Default per-socket critical-event bound. */
export const DEFAULT_MAX_BUFFERED_EVENTS = 100;

/**
 * Enforces bounded per-socket output and detects slow consumers.
 *
 * Socket.io queues packets in memory when a client stops reading. This
 * controller keeps that queue bounded:
 *
 * - `Lossy` events are emitted with `volatile` and dropped (never buffered)
 *   while the transport is congested.
 * - `Critical` events are buffered up to `maxBufferedEventsPerSocket`; once that
 *   bound is crossed the socket is reported as a slow consumer and evicted.
 *
 * The controller is transport-agnostic and depends only on the small
 * `Socket`-shaped surface it uses, so it can be unit-tested with fakes.
 */
export class SocketFlowController {
  private readonly maxBufferedEventsPerSocket: number;
  private readonly buffered = new Map<string, number>();
  private readonly stats: FlowControlStats = { evicted: 0, dropped: 0 };
  private readonly onEvict?: (socket: Socket) => void;

  constructor(
    options: FlowControlOptions = {},
    onEvict?: (socket: Socket) => void
  ) {
    this.maxBufferedEventsPerSocket =
      options.maxBufferedEventsPerSocket ?? DEFAULT_MAX_BUFFERED_EVENTS;
    this.onEvict = onEvict;
  }

  /**
   * Emit `event` to `socket`, respecting its delivery class.
   *
   * @returns `true` when the event was accepted (sent or, for critical events,
   * queued within the bound); `false` when it was dropped or the socket evicted.
   */
  public send(
    socket: Socket,
    event: string,
    payload: unknown,
    delivery: DeliveryClass
  ): boolean {
    const writable = this.isWritable(socket);

    if (delivery === DeliveryClass.Lossy) {
      if (!writable) {
        this.stats.dropped += 1;
        return false;
      }
      socket.volatile.emit(event, payload);
      return true;
    }

    if (writable) {
      this.buffered.delete(socket.id);
      socket.emit(event, payload);
      return true;
    }

    const next = (this.buffered.get(socket.id) ?? 0) + 1;
    if (next > this.maxBufferedEventsPerSocket) {
      this.buffered.delete(socket.id);
      this.stats.evicted += 1;
      this.onEvict?.(socket);
      return false;
    }

    this.buffered.set(socket.id, next);
    socket.emit(event, payload);
    return true;
  }

  /** Clear a socket's backpressure counter once its transport drains. */
  public onDrain(socketId: string): void {
    this.buffered.delete(socketId);
  }

  /** Current number of buffered critical events for a socket. */
  public getBufferedCount(socketId: string): number {
    return this.buffered.get(socketId) ?? 0;
  }

  /** Aggregate counters for observability/tests. */
  public getStats(): FlowControlStats {
    return { ...this.stats };
  }

  private isWritable(socket: Socket): boolean {
    const transport = (
      socket.conn as { transport?: { writable?: boolean } } | undefined
    )?.transport;

    // When there is no transport (unit-test fakes), assume the socket is writable.
    return transport?.writable ?? true;
  }
}
