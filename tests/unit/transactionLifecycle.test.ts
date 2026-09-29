import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("../../src/config/logger");
jest.mock("../../src/config/config", () => ({
  default: { agent: { timeouts: {} }, jwt: { secret: "test-secret-32-chars-long-enough!!" } },
}));
jest.mock("../../src/Gateway/realtimeIntegration", () => ({
  TransactionUpdateHelper: {
    notifyCreated: jest.fn(),
    notifyPending: jest.fn(),
    notifyConfirmed: jest.fn(),
    notifyFailed: jest.fn(),
  },
}));

const mockSave = jest.fn();
const mockFindOneOrFail = jest.fn();
const mockFindOne = jest.fn();
const mockFind = jest.fn();
const mockCreate = jest.fn();

const mockRepo = {
  create: mockCreate,
  save: mockSave,
  findOneOrFail: mockFindOneOrFail,
  findOne: mockFindOne,
  find: mockFind,
};

jest.mock("../../src/config/Datasource", () => ({
  AppDataSource: { getRepository: jest.fn(() => mockRepo) },
  default: { getRepository: jest.fn(() => mockRepo) },
}));

import {
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  LifecycleState,
} from "../../src/transactions/TransactionLifecycle.entity";
import { TransactionLifecycleService } from "../../src/transactions/TransactionLifecycle.service";

// ── State machine unit tests (pure, no DB) ─────────────────────────────────────

describe("VALID_TRANSITIONS state machine", () => {
  it("allows intent → simulating", () => {
    expect(VALID_TRANSITIONS["intent"].has("simulating")).toBe(true);
  });

  it("allows intent → pending (delayed_job path)", () => {
    expect(VALID_TRANSITIONS["intent"].has("pending")).toBe(true);
  });

  it("allows submitting → submitted → confirmed", () => {
    expect(VALID_TRANSITIONS["submitting"].has("submitted")).toBe(true);
    expect(VALID_TRANSITIONS["submitted"].has("confirmed")).toBe(true);
  });

  it("allows any non-terminal state → failed", () => {
    const nonTerminal: LifecycleState[] = ["intent", "simulating", "executing", "pending", "waiting", "submitting", "submitted"];
    for (const s of nonTerminal) {
      expect(VALID_TRANSITIONS[s].has("failed")).toBe(true);
    }
  });

  it("allows any non-terminal state → cancelled (except submitted)", () => {
    const cancellable: LifecycleState[] = ["intent", "simulating", "executing", "pending", "waiting", "submitting"];
    for (const s of cancellable) {
      expect(VALID_TRANSITIONS[s].has("cancelled")).toBe(true);
    }
    // submitted can only go to confirmed or failed
    expect(VALID_TRANSITIONS["submitted"].has("cancelled")).toBe(false);
  });

  it("terminal states have no outgoing transitions", () => {
    for (const s of TERMINAL_STATES) {
      expect(VALID_TRANSITIONS[s].size).toBe(0);
    }
  });

  it("does not allow backwards transitions", () => {
    expect(VALID_TRANSITIONS["confirmed"].has("intent")).toBe(false);
    expect(VALID_TRANSITIONS["submitted"].has("simulating")).toBe(false);
    expect(VALID_TRANSITIONS["executing"].has("intent")).toBe(false);
  });
});

// ── TransactionLifecycleService unit tests (mocked repo) ──────────────────────

function makeRecord(state: LifecycleState, id = "lc-1") {
  return {
    id,
    userId: "u1",
    operationType: "swap" as const,
    state,
    correlationId: null,
    payload: null,
    metadata: null,
    lastTransitionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("TransactionLifecycleService", () => {
  let service: TransactionLifecycleService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionLifecycleService();
    mockCreate.mockImplementation((data: unknown) => data);
    mockSave.mockImplementation(async (data: unknown) => ({ ...data as object, id: "lc-1" }));
  });

  it("create() saves a record at intent state", async () => {
    const result = await service.create("u1", "swap", { from: "XLM" });
    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][0] as { state: string };
    expect(saved.state).toBe("intent");
    expect(result.id).toBe("lc-1");
  });

  it("transition() advances state and saves", async () => {
    mockFindOneOrFail.mockResolvedValue(makeRecord("intent"));
    await service.transition("lc-1", "simulating");
    const saved = mockSave.mock.calls[0][0] as { state: string };
    expect(saved.state).toBe("simulating");
  });

  it("transition() merges metadata", async () => {
    mockFindOneOrFail.mockResolvedValue(makeRecord("simulating"));
    await service.transition("lc-1", "executing", { metadata: { fee: 100 } });
    const saved = mockSave.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(saved.metadata).toMatchObject({ fee: 100 });
  });

  it("transition() throws on invalid transition", async () => {
    mockFindOneOrFail.mockResolvedValue(makeRecord("confirmed"));
    await expect(service.transition("lc-1", "simulating")).rejects.toThrow(
      /terminal state/
    );
  });

  it("transition() throws on disallowed transition", async () => {
    mockFindOneOrFail.mockResolvedValue(makeRecord("submitted"));
    await expect(service.transition("lc-1", "intent")).rejects.toThrow(
      /Invalid transition/
    );
  });

  it("fail() transitions to failed with reason", async () => {
    mockFindOneOrFail.mockResolvedValue(makeRecord("submitting"));
    await service.fail("lc-1", "network error");
    const saved = mockSave.mock.calls[0][0] as { state: string; lastTransitionReason: string };
    expect(saved.state).toBe("failed");
    expect(saved.lastTransitionReason).toBe("network error");
  });

  it("cancel() transitions to cancelled", async () => {
    mockFindOneOrFail.mockResolvedValue(makeRecord("pending"));
    await service.cancel("lc-1");
    const saved = mockSave.mock.calls[0][0] as { state: string };
    expect(saved.state).toBe("cancelled");
  });
});
