import * as StellarSdk from "@stellar/stellar-sdk";

// ─── Canonical event types ────────────────────────────────────────────────────

export type StellarEventType =
  | "soroban_contract"
  | "stellar_payment"
  | "stellar_account_created"
  | "stellar_trade"
  | "stellar_liquidity_pool"
  | "unknown";

export interface NormalizedEvent {
  /** Globally unique event id (from Stellar RPC or synthesised for Horizon ops) */
  id: string;
  type: StellarEventType;
  contractId?: string;
  /** Decoded topic array (first element is usually the event name) */
  topics: unknown[];
  /** Decoded event value / payload */
  payload: unknown;
  ledger: number;
  ledgerClosedAt: string;
  /** Raw source object for debugging / re-processing */
  raw: unknown;
}

// ─── Soroban contract event topics ───────────────────────────────────────────

export interface SwapEventPayload {
  fromAsset: string;
  toAsset: string;
  amountIn: string;
  amountOut: string;
  trader: string;
}

export interface TransferEventPayload {
  from: string;
  to: string;
  amount: string;
  asset: string;
}

export interface LiquidityEventPayload {
  pool: string;
  action: "deposit" | "withdraw";
  amounts: string[];
  shares: string;
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

/**
 * Converts raw Stellar RPC / Horizon events into a canonical NormalizedEvent.
 * All XDR decoding happens here so downstream consumers never touch raw XDR.
 */
export class EventNormalizer {
  /**
   * Normalise a Soroban contract event returned by SorobanRpc.getEvents().
   */
  normalizeSorobanEvent(
    raw: StellarSdk.SorobanRpc.Api.EventResponse
  ): NormalizedEvent {
    const topics = raw.topic.map((t) => {
      try {
        return StellarSdk.scValToNative(t);
      } catch {
        return t;
      }
    });

    let payload: unknown;
    try {
      payload = StellarSdk.scValToNative(raw.value);
    } catch {
      payload = raw.value;
    }

    return {
      id: raw.id,
      type: "soroban_contract",
      contractId: raw.contractId,
      topics,
      payload,
      ledger: raw.ledger,
      ledgerClosedAt: raw.ledgerClosedAt,
      raw,
    };
  }

  /**
   * Normalise a Horizon operation record (payment, account_created, etc.).
   */
  normalizeHorizonOperation(
    raw: Record<string, unknown>,
    ledger: number,
    ledgerClosedAt: string
  ): NormalizedEvent {
    const type = this.mapHorizonType(raw.type as string);
    return {
      id: String(raw.id ?? `horizon-${ledger}-${Math.random()}`),
      type,
      topics: [raw.type],
      payload: raw,
      ledger,
      ledgerClosedAt,
      raw,
    };
  }

  private mapHorizonType(opType: string): StellarEventType {
    switch (opType) {
      case "payment":
        return "stellar_payment";
      case "create_account":
        return "stellar_account_created";
      case "manage_buy_offer":
      case "manage_sell_offer":
        return "stellar_trade";
      case "liquidity_pool_deposit":
      case "liquidity_pool_withdraw":
        return "stellar_liquidity_pool";
      default:
        return "unknown";
    }
  }

  /**
   * Extract a typed SwapEventPayload from a normalised soroban event.
   * Returns null if the event does not match the swap schema.
   */
  extractSwapPayload(event: NormalizedEvent): SwapEventPayload | null {
    if (event.type !== "soroban_contract") return null;
    const [name] = event.topics;
    if (name !== "swap" && name !== "Swap") return null;
    const p = event.payload as Record<string, unknown>;
    if (!p) return null;
    return {
      fromAsset: String(p.from_asset ?? p.fromAsset ?? ""),
      toAsset: String(p.to_asset ?? p.toAsset ?? ""),
      amountIn: String(p.amount_in ?? p.amountIn ?? "0"),
      amountOut: String(p.amount_out ?? p.amountOut ?? "0"),
      trader: String(p.trader ?? ""),
    };
  }

  extractTransferPayload(event: NormalizedEvent): TransferEventPayload | null {
    if (event.type !== "soroban_contract") return null;
    const [name] = event.topics;
    if (name !== "transfer" && name !== "Transfer") return null;
    const p = event.payload as Record<string, unknown>;
    if (!p) return null;
    return {
      from: String(p.from ?? ""),
      to: String(p.to ?? ""),
      amount: String(p.amount ?? "0"),
      asset: String(p.asset ?? ""),
    };
  }
}

export const eventNormalizer = new EventNormalizer();
