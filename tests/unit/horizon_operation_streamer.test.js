"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const horizonOperationStreamer_service_1 = require("../../src/services/horizonOperationStreamer.service");
describe("HorizonOperationStreamerService", () => {
  let onmessageHandler;
  let onerrorHandler;
  let closeFn;
  let streamMock;
  let operationsBuilder;
  let server;
  beforeEach(() => {
    jest.useFakeTimers();
    closeFn = jest.fn();
    streamMock = jest.fn().mockImplementation((options) => {
      onmessageHandler = options.onmessage;
      onerrorHandler = options.onerror;
      return closeFn;
    });
    operationsBuilder = {
      cursor: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      stream: streamMock,
    };
    server = {
      operations: jest.fn().mockReturnValue(operationsBuilder),
    };
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });
  it("emits a large-operation alert for qualifying payments", () => {
    const service =
      new horizonOperationStreamer_service_1.HorizonOperationStreamerService({
        server,
        enabled: true,
        minAmount: 1000,
        reconnectDelayMs: 50,
      });
    const listener = jest.fn();
    service.onLargeOperation(listener);
    service.start();
    onmessageHandler === null || onmessageHandler === void 0
      ? void 0
      : onmessageHandler({
          id: "op-1",
          type: "payment",
          amount: "1500.0000000",
          asset_type: "native",
          from: "GFROMACCOUNT",
          to: "GTOACCOUNT",
          transaction_hash: "txhash1",
          created_at: "2026-02-25T12:00:00Z",
          ledger: 12345,
        });
    expect(listener).toHaveBeenCalledTimes(1);
    const alert = listener.mock.calls[0][0];
    expect(alert.operationId).toBe("op-1");
    expect(alert.operationType).toBe("payment");
    expect(alert.amount).toBe(1500);
    expect(alert.asset).toBe("XLM");
  });
  it("does not emit alerts for operations below threshold", () => {
    const service =
      new horizonOperationStreamer_service_1.HorizonOperationStreamerService({
        server,
        enabled: true,
        minAmount: 1000,
      });
    const listener = jest.fn();
    service.onLargeOperation(listener);
    service.start();
    onmessageHandler === null || onmessageHandler === void 0
      ? void 0
      : onmessageHandler({
          id: "op-2",
          type: "payment",
          amount: "12.5",
          asset_type: "native",
          transaction_hash: "txhash2",
          created_at: "2026-02-25T12:01:00Z",
        });
    expect(listener).not.toHaveBeenCalled();
  });
  it("reconnects after stream errors", () => {
    const service =
      new horizonOperationStreamer_service_1.HorizonOperationStreamerService({
        server,
        enabled: true,
        minAmount: 1000,
        reconnectDelayMs: 25,
      });
    service.start();
    expect(streamMock).toHaveBeenCalledTimes(1);
    onerrorHandler === null || onerrorHandler === void 0
      ? void 0
      : onerrorHandler(new Error("stream failed"));
    jest.advanceTimersByTime(25);
    expect(streamMock).toHaveBeenCalledTimes(2);
  });
  it("can unsubscribe listener and stop cleanly", () => {
    const service =
      new horizonOperationStreamer_service_1.HorizonOperationStreamerService({
        server,
        enabled: true,
        minAmount: 1000,
      });
    const listener = jest.fn();
    const unsubscribe = service.onLargeOperation(listener);
    service.start();
    unsubscribe();
    onmessageHandler === null || onmessageHandler === void 0
      ? void 0
      : onmessageHandler({
          id: "op-3",
          type: "payment",
          amount: "1200",
          asset_type: "native",
          transaction_hash: "txhash3",
          created_at: "2026-02-25T12:02:00Z",
        });
    expect(listener).not.toHaveBeenCalled();
    service.stop();
    expect(closeFn).toHaveBeenCalled();
    // Ensure event name remains stable for downstream consumers
    expect(horizonOperationStreamer_service_1.LARGE_OPERATION_ALERT_EVENT).toBe(
      "stellar.large_operation"
    );
  });
});
