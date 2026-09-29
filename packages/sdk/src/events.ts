import {
  EventSubscriptionConfig,
  SorobanEvent,
  EventHandler,
  ErrorHandler,
  EventSubscription,
} from "./types";

interface RpcEvent {
  type?: string;
  contractId?: string;
  topic?: unknown[];
  value?: unknown;
}

const DEFAULT_RPC_URLS: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

const DEFAULT_POLLING_INTERVAL_MS = 5000;

export class SorobanEventSubscription implements EventSubscription {
  private config: EventSubscriptionConfig;
  private rpcUrl: string;
  private isActive_: boolean = false;
  private lastLedger_: number | null = null;
  private pollingHandle_: NodeJS.Timeout | null = null;
  private eventHandlers: Set<EventHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private processedTransactions: Set<string> = new Set();

  constructor(config: EventSubscriptionConfig) {
    if (!config.contractIds || config.contractIds.length === 0) {
      throw new Error("At least one contractId is required");
    }

    this.config = config;
    this.rpcUrl = config.rpcUrl || DEFAULT_RPC_URLS[config.network];

    if (!this.rpcUrl) {
      throw new Error(`Unknown network: ${config.network}`);
    }
  }

  on(event: "event", handler: EventHandler): this;
  on(event: "error", handler: ErrorHandler): this;
  on(event: string, handler: EventHandler | ErrorHandler): this {
    if (event === "event") {
      this.eventHandlers.add(handler as EventHandler);
    } else if (event === "error") {
      this.errorHandlers.add(handler as ErrorHandler);
    }
    return this;
  }

  off(event: "event", handler: EventHandler): this;
  off(event: "error", handler: ErrorHandler): this;
  off(event: string, handler: EventHandler | ErrorHandler): this {
    if (event === "event") {
      this.eventHandlers.delete(handler as EventHandler);
    } else if (event === "error") {
      this.errorHandlers.delete(handler as ErrorHandler);
    }
    return this;
  }

  async subscribe(): Promise<void> {
    if (this.isActive_) {
      return;
    }

    this.isActive_ = true;
    const interval =
      this.config.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;

    await this.poll();
    this.pollingHandle_ = setInterval(() => {
      this.poll().catch((err) => this.emitError(err));
    }, interval);
  }

  async unsubscribe(): Promise<void> {
    if (!this.isActive_) {
      return;
    }

    this.isActive_ = false;
    if (this.pollingHandle_) {
      clearInterval(this.pollingHandle_);
      this.pollingHandle_ = null;
    }
    this.eventHandlers.clear();
    this.errorHandlers.clear();
  }

  isActive(): boolean {
    return this.isActive_;
  }

  getLastLedger(): number | null {
    return this.lastLedger_;
  }

  private async poll(): Promise<void> {
    try {
      const events = await this.fetchRecentEvents();
      for (const event of events) {
        await this.emitEvent(event);
      }
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async fetchRecentEvents(): Promise<SorobanEvent[]> {
    return [];
  }

  private async emitEvent(event: SorobanEvent): Promise<void> {
    if (this.processedTransactions.has(event.transactionHash)) {
      return;
    }
    this.processedTransactions.add(event.transactionHash);

    if (this.config.topicFilter && this.config.topicFilter.length > 0) {
      const hasMatchingTopic = event.topics.some((topic) =>
        this.config.topicFilter!.some((filter) => topic.includes(filter))
      );
      if (!hasMatchingTopic) {
        return;
      }
    }

    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        void handler(error);
      } catch {
        // Ignore errors in error handlers
      }
    }
  }
}

export async function subscribeToEvents(
  config: EventSubscriptionConfig
): Promise<EventSubscription> {
  const subscription = new SorobanEventSubscription(config);
  await subscription.subscribe();
  return subscription;
}

export function parseEvent(
  raw: RpcEvent,
  contractId: string,
  transactionHash: string,
  ledger: number,
  createdAt: number
): SorobanEvent {
  return {
    transactionHash,
    contractId,
    topics: Array.isArray(raw.topic)
      ? (raw.topic as unknown[]).map((t) =>
          typeof t === "string" ? t : JSON.stringify(t)
        )
      : [],
    data: raw.value ?? null,
    ledger,
    createdAt,
  };
}

// ─── CoreVault contract event types ─────────────────────────────────────────
//
// Canonical event shape emitted by core_vault:
//   topics[0] = symbol  ("init" | "deposit" | "w" | "fexit_req" | "fexit_c" | "recovery" | "upg_prop" | "upg_cncl" | "upg_done" | "adm_xfer")
//   topics[1] = user/address (present for user-specific events)
//   data      = named struct (see contract EvtXxx types)
//
// Replaying these events in ledger order fully reconstructs contract state.

export type VaultEventTopic =
  | "init"
  | "deposit"
  | "w"
  | "fexit_req"
  | "fexit_c"
  | "recovery"
  | "upg_prop"
  | "upg_cncl"
  | "upg_done"
  | "adm_xfer";

export interface VaultEventInit {
  topic: "init";
  contractId: string;
  admin: string;
  ledger: number;
  txHash: string;
}

export interface VaultEventDeposit {
  topic: "deposit";
  contractId: string;
  user: string;
  amount: string;
  totalDeposited: string;
  ledger: number;
  txHash: string;
}

export interface VaultEventWithdrawal {
  topic: "w";
  contractId: string;
  user: string;
  amount: string;
  ledger: number;
  txHash: string;
}

export interface VaultEventForceExitRequest {
  topic: "fexit_req";
  contractId: string;
  user: string;
  amount: string;
  eligibleAt: number;
  ledger: number;
  txHash: string;
}

export interface VaultEventForceExitComplete {
  topic: "fexit_c";
  contractId: string;
  user: string;
  amount: string;
  eligibleAt: number;
  ledger: number;
  txHash: string;
}

export interface VaultEventRecovery {
  topic: "recovery";
  contractId: string;
  user: string;
  amount: string;
  reason: "ForceExitTimeout" | "AdminIntervention";
  ledger: number;
  txHash: string;
}

export interface VaultEventUpgradeProposed {
  topic: "upg_prop";
  contractId: string;
  admin: string;
  newWasmHash: string;
  unlockLedger: number;
  ledger: number;
  txHash: string;
}

export interface VaultEventUpgradeCancelled {
  topic: "upg_cncl";
  contractId: string;
  admin: string;
  ledger: number;
  txHash: string;
}

export interface VaultEventUpgradeApplied {
  topic: "upg_done";
  contractId: string;
  newWasmHash: string;
  ledger: number;
  txHash: string;
}

export interface VaultEventAdminTransferred {
  topic: "adm_xfer";
  contractId: string;
  oldAdmin: string;
  newAdmin: string;
  ledger: number;
  txHash: string;
}

export type VaultEvent =
  | VaultEventInit
  | VaultEventDeposit
  | VaultEventWithdrawal
  | VaultEventForceExitRequest
  | VaultEventForceExitComplete
  | VaultEventRecovery
  | VaultEventUpgradeProposed
  | VaultEventUpgradeCancelled
  | VaultEventUpgradeApplied
  | VaultEventAdminTransferred;

// ─── Typed data shapes decoded from XDR ─────────────────────────────────────

interface EvtInitData {
  admin: string;
}
interface EvtDepositData {
  user: string;
  amount: string;
  total_deposited: string;
}
interface EvtWithdrawalData {
  user: string;
  amount: string;
}
interface EvtForceExitReqData {
  user?: string;
  amount: string;
  eligible_at: number;
}
interface EvtRecoveryData {
  user: string;
  amount: string;
  reason: "ForceExitTimeout" | "AdminIntervention";
}
interface EvtUpgPropData {
  admin: string;
  new_wasm_hash: string;
  unlock_ledger: number;
}
interface EvtUpgCnclData {
  admin: string;
}
interface EvtUpgDoneData {
  new_wasm_hash: string;
}
interface EvtAdmXferData {
  old_admin: string;
  new_admin: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

/**
 * Parse a raw SorobanEvent from core_vault into a typed VaultEvent.
 * topics[0] = symbol, topics[1] = contract_id or user address, data = named struct.
 * Returns null for unrecognised topics.
 */
export function parseVaultEvent(event: SorobanEvent): VaultEvent | null {
  const topic = event.topics[0] as VaultEventTopic | undefined;
  const contractId = str(event.topics[1]);
  const { ledger, transactionHash: txHash } = event;
  const d = event.data as Record<string, unknown> | null;

  switch (topic) {
    case "init": {
      const data = d as EvtInitData | null;
      return { topic, contractId, admin: str(data?.admin), ledger, txHash };
    }
    case "deposit": {
      const data = d as EvtDepositData | null;
      return {
        topic,
        contractId,
        user: str(data?.user),
        amount: str(data?.amount),
        totalDeposited: str(data?.total_deposited),
        ledger,
        txHash,
      };
    }
    case "w": {
      const data = d as EvtWithdrawalData | null;
      return {
        topic,
        contractId,
        user: str(data?.user),
        amount: str(data?.amount),
        ledger,
        txHash,
      };
    }
    case "fexit_req": {
      const data = d as EvtForceExitReqData | null;
      return {
        topic,
        contractId,
        user: str((d as EvtForceExitReqData | null)?.user ?? contractId),
        amount: str(data?.amount),
        eligibleAt: num(data?.eligible_at),
        ledger,
        txHash,
      };
    }
    case "fexit_c": {
      const data = d as EvtForceExitReqData | null;
      return {
        topic,
        contractId,
        user: str((d as EvtForceExitReqData | null)?.user ?? contractId),
        amount: str(data?.amount),
        eligibleAt: num(data?.eligible_at),
        ledger,
        txHash,
      };
    }
    case "recovery": {
      const data = d as EvtRecoveryData | null;
      return {
        topic,
        contractId,
        user: str((d as EvtRecoveryData | null)?.user ?? contractId),
        amount: str(data?.amount),
        reason: (data?.reason as "ForceExitTimeout" | "AdminIntervention") ?? "AdminIntervention",
        ledger,
        txHash,
      };
    }
    case "upg_prop": {
      const data = d as EvtUpgPropData | null;
      return {
        topic,
        contractId,
        admin: str(data?.admin),
        newWasmHash: str(data?.new_wasm_hash),
        unlockLedger: num(data?.unlock_ledger),
        ledger,
        txHash,
      };
    }
    case "upg_cncl": {
      const data = d as EvtUpgCnclData | null;
      return { topic, contractId, admin: str(data?.admin), ledger, txHash };
    }
    case "upg_done": {
      const data = d as EvtUpgDoneData | null;
      return {
        topic,
        contractId,
        newWasmHash: str(data?.new_wasm_hash),
        ledger,
        txHash,
      };
    }
    case "adm_xfer": {
      const data = d as EvtAdmXferData | null;
      return {
        topic,
        contractId,
        oldAdmin: str(data?.old_admin),
        newAdmin: str(data?.new_admin),
        ledger,
        txHash,
      };
    }
    default:
      return null;
  }
}

// ─── State reconstruction ────────────────────────────────────────────────────

export interface VaultState {
  admin: string | null;
  pendingUpgrade: { newWasmHash: string; unlockLedger: number } | null;
  currentWasmHash: string | null;
  deposits: Map<string, string>; // user -> amount
}

/**
 * Replay vault events (sorted ascending by ledger) to reconstruct contract state.
 * No ledger queries needed — the event stream is the source of truth.
 */
export function reconstructVaultState(events: VaultEvent[]): VaultState {
  const state: VaultState = {
    admin: null,
    pendingUpgrade: null,
    currentWasmHash: null,
    deposits: new Map(),
  };

  for (const e of events) {
    switch (e.topic) {
      case "init":
        state.admin = e.admin;
        break;
      case "deposit":
        state.deposits.set(e.user, e.totalDeposited);
        break;
      case "w": {
        const current = state.deposits.get(e.user) ?? "0";
        const currentNum = BigInt(current);
        const withdrawnNum = BigInt(e.amount);
        const remaining = currentNum - withdrawnNum;
        if (remaining <= 0n) {
          state.deposits.delete(e.user);
        } else {
          state.deposits.set(e.user, remaining.toString());
        }
        break;
      }
      case "fexit_req":
        break;
      case "fexit_c":
        state.deposits.delete(e.user);
        break;
      case "recovery":
        // Recovery cancels the pending request - deposit was never removed during force_exit_request
        // No state change needed
        break;
      case "upg_prop":
        state.pendingUpgrade = {
          newWasmHash: e.newWasmHash,
          unlockLedger: e.unlockLedger,
        };
        break;
      case "upg_cncl":
        state.pendingUpgrade = null;
        break;
      case "upg_done":
        state.currentWasmHash = e.newWasmHash;
        state.pendingUpgrade = null;
        break;
      case "adm_xfer":
        state.admin = e.newAdmin;
        break;
    }
  }

  return state;
}