/**
 * Typed contract-event decoding registry for Soroban applications (#574).
 *
 * Raw {@link SorobanEvent}s arrive as `{ topics: string[], data: unknown }`.
 * Applications need to turn those into typed, meaningful objects, and the
 * decoding often changes between contract versions. This module provides a
 * registry that maps `(contractId, eventType, version)` to a decoder function
 * so apps decode events consistently across contract versions.
 *
 * The registry is pure (no network access) and framework-agnostic.
 */

import { SorobanEvent } from "./types";
import { ErrorRegistry } from "./errorRegistry";

/** Wildcard matching any contract id. */
export const ANY_CONTRACT = "*" as const;
/** Wildcard matching any version. */
export const ANY_VERSION = "*" as const;

/** A decoder turns a raw event into a typed payload. */
export type EventDecoder<T = unknown> = (event: SorobanEvent) => T;

/** Result of decoding an event. */
export interface DecodedEvent<T = unknown> {
  /** The event type (conventionally the first topic). */
  eventType: string;
  /** Contract that emitted the event. */
  contractId: string;
  /** Contract version the decoder was registered for, if version-specific. */
  version?: string;
  /** The typed, decoded payload. */
  data: T;
  /** The original raw event, preserved for auditing. */
  raw: SorobanEvent;
}

/** A single decoder registration. */
export interface EventDecoderRegistration<T = unknown> {
  /** Event type to match — conventionally `event.topics[0]`. */
  eventType: string;
  /** Contract id to match, or {@link ANY_CONTRACT} for all contracts. */
  contractId?: string;
  /** Contract version to match, or {@link ANY_VERSION} for all versions. */
  version?: string;
  /** The decoder implementation. */
  decoder: EventDecoder<T>;
}

/** Options for {@link EventDecoderRegistry.decode}. */
export interface DecodeOptions {
  /** Contract version hint used to select a version-specific decoder. */
  version?: string;
  /**
   * When true (default), decoding an event with no matching decoder throws.
   * When false, {@link EventDecoderRegistry.decode} returns `undefined`.
   */
  strict?: boolean;
}

function key(contractId: string, eventType: string, version: string): string {
  return `${contractId}::${eventType}::${version}`;
}

/**
 * Registry of typed event decoders. Decoder selection prefers the most specific
 * match, falling back progressively:
 *
 *   1. exact contract + exact version
 *   2. exact contract + ANY_VERSION
 *   3. ANY_CONTRACT + exact version
 *   4. ANY_CONTRACT + ANY_VERSION
 */
export class EventDecoderRegistry {
  private decoders = new Map<string, EventDecoder>();

  /** Register a decoder. Returns `this` for chaining. Later registrations of the same key win. */
  register<T>(registration: EventDecoderRegistration<T>): this {
    const contractId = registration.contractId ?? ANY_CONTRACT;
    const version = registration.version ?? ANY_VERSION;
    this.decoders.set(
      key(contractId, registration.eventType, version),
      registration.decoder as EventDecoder
    );
    return this;
  }

  /** Register many decoders at once. */
  registerAll(registrations: EventDecoderRegistration[]): this {
    for (const r of registrations) this.register(r);
    return this;
  }

  /** Whether any decoder could handle this event/version. */
  has(
    event: Pick<SorobanEvent, "contractId" | "topics">,
    version?: string
  ): boolean {
    return this.resolve(event, version) !== undefined;
  }

  /** Resolve the best-matching decoder for an event, or `undefined`. */
  resolve(
    event: Pick<SorobanEvent, "contractId" | "topics">,
    version?: string
  ): EventDecoder | undefined {
    const eventType = event.topics?.[0];
    if (!eventType) return undefined;
    const v = version ?? ANY_VERSION;

    const candidates = [
      key(event.contractId, eventType, v),
      key(event.contractId, eventType, ANY_VERSION),
      key(ANY_CONTRACT, eventType, v),
      key(ANY_CONTRACT, eventType, ANY_VERSION),
    ];
    for (const c of candidates) {
      const decoder = this.decoders.get(c);
      if (decoder) return decoder;
    }
    return undefined;
  }

  /**
   * Decode a single event. Throws an {@link SdkError} (`EVENT_DECODER_NOT_FOUND`
   * or `EVENT_DECODE_FAILED`) in strict mode; otherwise returns `undefined`
   * when no decoder matches.
   */
  decode<T = unknown>(
    event: SorobanEvent,
    options: DecodeOptions = {}
  ): DecodedEvent<T> | undefined {
    const strict = options.strict ?? true;
    const eventType = event.topics?.[0];
    const decoder = this.resolve(event, options.version);

    if (!decoder) {
      if (strict) {
        throw ErrorRegistry.createError("EVENT_DECODER_NOT_FOUND", {
          message: `No decoder registered for event '${eventType ?? "<no-topic>"}' on contract ${event.contractId}`,
          details: {
            contractId: event.contractId,
            eventType,
            version: options.version,
          },
        });
      }
      return undefined;
    }

    try {
      return {
        eventType: eventType as string,
        contractId: event.contractId,
        version: options.version,
        data: decoder(event) as T,
        raw: event,
      };
    } catch (cause) {
      throw ErrorRegistry.createError("EVENT_DECODE_FAILED", {
        message: `Decoder for '${eventType}' failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        details: {
          contractId: event.contractId,
          eventType,
          version: options.version,
        },
        cause,
      });
    }
  }

  /**
   * Decode a batch of events. Unmatched events are skipped when
   * `options.strict` is false; otherwise the first failure throws.
   */
  decodeAll<T = unknown>(
    events: SorobanEvent[],
    options: DecodeOptions = {}
  ): DecodedEvent<T>[] {
    const out: DecodedEvent<T>[] = [];
    for (const event of events) {
      const decoded = this.decode<T>(event, options);
      if (decoded) out.push(decoded);
    }
    return out;
  }

  /** Number of registered decoders. */
  get size(): number {
    return this.decoders.size;
  }

  /** Remove all registrations. */
  clear(): void {
    this.decoders.clear();
  }
}

/**
 * A shared, process-wide registry. Applications may use this singleton or create
 * their own {@link EventDecoderRegistry} instances for isolation.
 */
export const globalEventDecoderRegistry = new EventDecoderRegistry();
