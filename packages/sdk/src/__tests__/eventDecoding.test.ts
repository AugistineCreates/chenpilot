/**
 * Tests for the typed event-decoding registry (#574).
 */

import {
  EventDecoderRegistry,
  ANY_CONTRACT,
  ANY_VERSION,
} from "../eventDecoding";
import { SorobanEvent } from "../types";
import { SdkError } from "../errors";

function evt(
  partial: Partial<SorobanEvent> & { topics: string[]; contractId: string }
): SorobanEvent {
  return {
    transactionHash: "tx",
    ledger: 1,
    createdAt: 1704067200,
    data: null,
    ...partial,
  } as SorobanEvent;
}

describe("EventDecoderRegistry", () => {
  it("decodes an event with a matching contract+eventType decoder", () => {
    const reg = new EventDecoderRegistry();
    reg.register({
      eventType: "deposit",
      contractId: "C1",
      decoder: (e) => ({ amount: (e.data as { amount: number }).amount }),
    });

    const decoded = reg.decode<{ amount: number }>(
      evt({ contractId: "C1", topics: ["deposit"], data: { amount: 42 } })
    );
    expect(decoded?.data.amount).toBe(42);
    expect(decoded?.eventType).toBe("deposit");
    expect(decoded?.contractId).toBe("C1");
  });

  it("prefers a version-specific decoder over a wildcard-version one", () => {
    const reg = new EventDecoderRegistry();
    reg.register({
      eventType: "x",
      contractId: "C1",
      version: ANY_VERSION,
      decoder: () => "any",
    });
    reg.register({
      eventType: "x",
      contractId: "C1",
      version: "2.0.0",
      decoder: () => "v2",
    });

    const anyV = reg.decode(evt({ contractId: "C1", topics: ["x"] }));
    const v2 = reg.decode(evt({ contractId: "C1", topics: ["x"] }), {
      version: "2.0.0",
    });
    expect(anyV?.data).toBe("any");
    expect(v2?.data).toBe("v2");
  });

  it("falls back to an ANY_CONTRACT decoder", () => {
    const reg = new EventDecoderRegistry();
    reg.register({
      eventType: "ping",
      contractId: ANY_CONTRACT,
      decoder: () => "pong",
    });
    const decoded = reg.decode(
      evt({ contractId: "whatever", topics: ["ping"] })
    );
    expect(decoded?.data).toBe("pong");
  });

  it("throws EVENT_DECODER_NOT_FOUND in strict mode and returns undefined otherwise", () => {
    const reg = new EventDecoderRegistry();
    const event = evt({ contractId: "C1", topics: ["unknown"] });
    expect(() => reg.decode(event)).toThrow(SdkError);
    try {
      reg.decode(event);
    } catch (e) {
      expect((e as SdkError).code).toBe("EVENT_DECODER_NOT_FOUND");
    }
    expect(reg.decode(event, { strict: false })).toBeUndefined();
  });

  it("wraps decoder exceptions as EVENT_DECODE_FAILED", () => {
    const reg = new EventDecoderRegistry();
    reg.register({
      eventType: "boom",
      contractId: "C1",
      decoder: () => {
        throw new Error("kaboom");
      },
    });
    try {
      reg.decode(evt({ contractId: "C1", topics: ["boom"] }));
      fail("expected throw");
    } catch (e) {
      expect((e as SdkError).code).toBe("EVENT_DECODE_FAILED");
      expect((e as SdkError).message).toMatch(/kaboom/);
    }
  });

  it("has(), size, clear() and decodeAll() behave as expected", () => {
    const reg = new EventDecoderRegistry();
    reg.registerAll([
      { eventType: "a", contractId: "C1", decoder: () => "A" },
      { eventType: "b", contractId: "C1", decoder: () => "B" },
    ]);
    expect(reg.size).toBe(2);
    expect(reg.has({ contractId: "C1", topics: ["a"] })).toBe(true);
    expect(reg.has({ contractId: "C1", topics: ["z"] })).toBe(false);

    const decoded = reg.decodeAll(
      [
        evt({ contractId: "C1", topics: ["a"] }),
        evt({ contractId: "C1", topics: ["z"] }),
        evt({ contractId: "C1", topics: ["b"] }),
      ],
      { strict: false }
    );
    expect(decoded.map((d) => d.data)).toEqual(["A", "B"]);

    reg.clear();
    expect(reg.size).toBe(0);
  });
});
