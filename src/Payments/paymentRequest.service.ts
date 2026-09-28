import {
  ChainPaymentEvent,
  Clock,
  PaymentRequest,
  PaymentRequestMatchResult,
  PaymentRequirement,
  systemClock,
} from "./paymentTypes";
import { addAmount, compareAmount, formatAmount, parseAmount, subtractAmount } from "./money";

export class PaymentRequestService {
  private readonly requests = new Map<string, PaymentRequest>();
  private readonly eventIds = new Set<string>();

  constructor(private readonly clock: Clock = systemClock) {}

  createRequest(params: {
    id: string;
    requirement: PaymentRequirement;
    expiresAt?: Date;
  }): PaymentRequest {
    if (this.requests.has(params.id)) {
      throw new Error(`Payment request already exists: ${params.id}`);
    }
    parseAmount(params.requirement.amount);

    const request: PaymentRequest = {
      id: params.id,
      requirement: params.requirement,
      status: "open",
      paidAmount: "0",
      createdAt: this.clock.now(),
      expiresAt: params.expiresAt,
      events: [],
    };
    this.requests.set(request.id, request);
    return this.clone(request);
  }

  shareRequest(id: string): string {
    const request = this.requireRequest(id);
    return `chenpilot:pay/${encodeURIComponent(request.id)}?network=${encodeURIComponent(
      request.requirement.network
    )}&asset=${encodeURIComponent(request.requirement.asset.code)}&amount=${encodeURIComponent(
      request.requirement.amount
    )}&recipient=${encodeURIComponent(request.requirement.recipient)}`;
  }

  expireRequests(now = this.clock.now()): PaymentRequest[] {
    const expired: PaymentRequest[] = [];
    for (const request of this.requests.values()) {
      if (
        request.expiresAt &&
        request.expiresAt.getTime() <= now.getTime() &&
        (request.status === "open" || request.status === "partially_paid")
      ) {
        request.status = "expired";
        expired.push(this.clone(request));
      }
    }
    return expired;
  }

  cancelRequest(id: string, cancelledAt = this.clock.now()): PaymentRequest {
    const request = this.requireRequest(id);
    if (request.status === "paid" || request.status === "overpaid") {
      throw new Error(`Cannot cancel fulfilled payment request: ${id}`);
    }
    request.status = "cancelled";
    request.cancelledAt = cancelledAt;
    return this.clone(request);
  }

  matchIncomingPayment(id: string, event: ChainPaymentEvent): PaymentRequestMatchResult {
    const request = this.requireRequest(id);
    this.expireRequests(event.observedAt);

    if (!["open", "partially_paid"].includes(request.status)) {
      return this.result("closed", request);
    }
    if (this.eventIds.has(event.id)) {
      return this.result("duplicate", request);
    }
    if (event.network !== request.requirement.network) {
      return this.result("wrong_network", request);
    }
    if (!sameAsset(event.asset, request.requirement.asset)) {
      return this.result("wrong_asset", request);
    }
    if (event.recipient !== request.requirement.recipient) {
      return this.result("wrong_recipient", request);
    }

    this.eventIds.add(event.id);
    request.events.push({ ...event });
    request.paidAmount = addAmount(request.paidAmount, event.amount);

    const comparison = compareAmount(request.paidAmount, request.requirement.amount);
    request.status =
      comparison < 0 ? "partially_paid" : comparison === 0 ? "paid" : "overpaid";

    return this.result("accepted", request);
  }

  getRequest(id: string): PaymentRequest | undefined {
    const request = this.requests.get(id);
    return request ? this.clone(request) : undefined;
  }

  private result(
    status: PaymentRequestMatchResult["status"],
    request: PaymentRequest
  ): PaymentRequestMatchResult {
    const remainingRaw = parseAmount(request.requirement.amount) - parseAmount(request.paidAmount);
    return {
      status,
      request: this.clone(request),
      remainingAmount: formatAmount(remainingRaw > 0n ? remainingRaw : 0n),
      overpaidAmount:
        remainingRaw < 0n ? subtractAmount(request.paidAmount, request.requirement.amount) : "0",
    };
  }

  private requireRequest(id: string): PaymentRequest {
    const request = this.requests.get(id);
    if (!request) throw new Error(`Unknown payment request: ${id}`);
    return request;
  }

  private clone(request: PaymentRequest): PaymentRequest {
    return {
      ...request,
      createdAt: new Date(request.createdAt),
      expiresAt: request.expiresAt ? new Date(request.expiresAt) : undefined,
      cancelledAt: request.cancelledAt ? new Date(request.cancelledAt) : undefined,
      events: request.events.map((event) => ({ ...event, observedAt: new Date(event.observedAt) })),
    };
  }
}

function sameAsset(a: PaymentRequirement["asset"], b: PaymentRequirement["asset"]): boolean {
  return a.code === b.code && (a.issuer ?? "") === (b.issuer ?? "");
}
