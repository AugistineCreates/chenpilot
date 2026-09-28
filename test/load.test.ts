/**
 * Slow-consumer / bounded-buffer tests for the realtime gateway.
 *
 * These replace the previous empty `test('slow consumer', () => {})` stub. They
 * exercise `SocketFlowController` directly with controllable fake sockets so the
 * behaviour under backpressure is deterministic:
 *
 *   - lossy events are dropped (never buffered) while a client stalls;
 *   - critical events are buffered up to a hard per-socket bound;
 *   - exceeding the bound evicts the slow consumer and releases its buffer;
 *   - backpressure accounting is per-socket and clears on drain.
 */

import type { Socket } from "socket.io";
import {
  DeliveryClass,
  SocketFlowController,
} from "../src/Gateway/flowControl";

interface EmittedEvent {
  event: string;
  payload: unknown;
  volatile: boolean;
}

interface FakeSocket {
  id: string;
  emitted: EmittedEvent[];
  disconnected: number;
  writable: boolean;
  socket: Socket;
}

function createFakeSocket(id: string, writable = true): FakeSocket {
  const fake: FakeSocket = {
    id,
    emitted: [],
    disconnected: 0,
    writable,
    socket: undefined as unknown as Socket,
  };

  fake.socket = {
    id,
    get conn() {
      return { transport: { writable: fake.writable } };
    },
    emit(event: string, payload?: unknown) {
      fake.emitted.push({ event, payload, volatile: false });
    },
    volatile: {
      emit(event: string, payload?: unknown) {
        fake.emitted.push({ event, payload, volatile: true });
      },
    },
    disconnect() {
      fake.disconnected += 1;
    },
  } as unknown as Socket;

  return fake;
}

describe("SocketFlowController - bounded buffers", () => {
  it("sends to a writable socket without buffering", () => {
    const controller = new SocketFlowController({
      maxBufferedEventsPerSocket: 3,
    });
    const client = createFakeSocket("writable-1");

    expect(
      controller.send(client.socket, "tx", {}, DeliveryClass.Critical)
    ).toBe(true);
    expect(controller.send(client.socket, "tx", {}, DeliveryClass.Lossy)).toBe(
      true
    );

    expect(client.emitted).toHaveLength(2);
    expect(controller.getBufferedCount(client.id)).toBe(0);
    expect(controller.getStats()).toEqual({ evicted: 0, dropped: 0 });
  });

  it("drops lossy events instead of buffering when a consumer stalls", () => {
    const controller = new SocketFlowController({
      maxBufferedEventsPerSocket: 5,
    });
    const stalled = createFakeSocket("stalled-lossy", false);

    for (let i = 0; i < 50; i += 1) {
      expect(
        controller.send(stalled.socket, "tx", { i }, DeliveryClass.Lossy)
      ).toBe(false);
    }

    expect(stalled.emitted).toHaveLength(0);
    expect(controller.getBufferedCount(stalled.id)).toBe(0);
    expect(controller.getStats().dropped).toBe(50);
  });

  it("buffers critical events up to the bound then evicts the slow consumer", () => {
    const evicted: string[] = [];
    const controller = new SocketFlowController(
      { maxBufferedEventsPerSocket: 2 },
      (socket) => evicted.push(socket.id)
    );
    const stalled = createFakeSocket("stalled-critical", false);

    expect(
      controller.send(stalled.socket, "c1", {}, DeliveryClass.Critical)
    ).toBe(true);
    expect(
      controller.send(stalled.socket, "c2", {}, DeliveryClass.Critical)
    ).toBe(true);
    expect(controller.getBufferedCount(stalled.id)).toBe(2);

    // One past the bound is rejected and the socket is evicted.
    expect(
      controller.send(stalled.socket, "c3", {}, DeliveryClass.Critical)
    ).toBe(false);

    expect(evicted).toEqual([stalled.id]);
    expect(controller.getBufferedCount(stalled.id)).toBe(0);
    expect(controller.getStats().evicted).toBe(1);
  });

  it("keeps per-socket buffering bounded under sustained pressure", () => {
    const maxBuffered = 5;
    const controller = new SocketFlowController({
      maxBufferedEventsPerSocket: maxBuffered,
    });
    const stalled = createFakeSocket("stalled-sustained", false);

    let observedMax = 0;
    for (let i = 0; i < 500; i += 1) {
      controller.send(
        stalled.socket,
        "critical",
        { i },
        DeliveryClass.Critical
      );
      observedMax = Math.max(
        observedMax,
        controller.getBufferedCount(stalled.id)
      );
    }

    expect(observedMax).toBeLessThanOrEqual(maxBuffered);
    expect(controller.getStats().evicted).toBeGreaterThanOrEqual(1);
  });

  it("clears the backpressure counter when the transport drains", () => {
    const controller = new SocketFlowController({
      maxBufferedEventsPerSocket: 5,
    });
    const client = createFakeSocket("drains", false);

    controller.send(client.socket, "c1", {}, DeliveryClass.Critical);
    controller.send(client.socket, "c2", {}, DeliveryClass.Critical);
    expect(controller.getBufferedCount(client.id)).toBe(2);

    controller.onDrain(client.id);
    expect(controller.getBufferedCount(client.id)).toBe(0);

    // After draining, the socket can buffer again up to the bound.
    controller.send(client.socket, "c3", {}, DeliveryClass.Critical);
    expect(controller.getBufferedCount(client.id)).toBe(1);
  });

  it("isolates backpressure per socket", () => {
    const evicted: string[] = [];
    const controller = new SocketFlowController(
      { maxBufferedEventsPerSocket: 2 },
      (socket) => evicted.push(socket.id)
    );
    const first = createFakeSocket("first", false);
    const second = createFakeSocket("second", false);

    controller.send(first.socket, "c", {}, DeliveryClass.Critical);
    controller.send(first.socket, "c", {}, DeliveryClass.Critical);
    controller.send(second.socket, "c", {}, DeliveryClass.Critical);
    controller.send(second.socket, "c", {}, DeliveryClass.Critical);

    // Evicting the first socket must not disturb the second socket's buffer.
    expect(controller.send(first.socket, "c", {}, DeliveryClass.Critical)).toBe(
      false
    );
    expect(controller.getBufferedCount(first.id)).toBe(0);
    expect(controller.getBufferedCount(second.id)).toBe(2);
    expect(evicted).toEqual([first.id]);
  });
});
