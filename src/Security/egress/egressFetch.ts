import {
  checkIpLiteralDestination,
  hostMatchesAllowlist,
  parseDestination,
} from "./urlGuard";
import {
  checkDestinationPolicy,
  DEFAULT_ADAPTER_EGRESS,
  DEFAULT_REQUEST_BUDGET,
  EgressBudget,
} from "./destinationPolicy";
import { checkResolvedAddresses, defaultHostResolver } from "./dnsGuard";
import {
  AdapterEgressConfig,
  EgressDenyReason,
  EgressRequestBudget,
  HostResolver,
} from "./types";

export class EgressError extends Error {
  public readonly reason: EgressDenyReason;
  public readonly url: string;

  constructor(reason: EgressDenyReason, url: string, message: string) {
    super(`egress: ${message}`);
    this.name = "EgressError";
    this.reason = reason;
    this.url = url;
  }
}

export interface SecureFetchOptions {
  /** Per-adapter default-deny manifest. */
  egress?: AdapterEgressConfig;
  /** Request budget. Defaults to DEFAULT_REQUEST_BUDGET. */
  budget?: EgressRequestBudget;
  /** DNS resolver (injectable for tests / rebinding simulation). */
  resolver?: HostResolver;
  /** Underlying transport; defaults to global fetch. */
  transport?: typeof globalThis.fetch;
  /** Unique key for concurrency budgeting. */
  budgetKey?: string;
  /** Shared budget tracker; created internally when omitted. */
  budgetTracker?: EgressBudget;
}

export class EgressController {
  private budgets = new Map<string, EgressBudget>();

  /**
   * Get (or create) a shared concurrency budget scoped to an adapter key.
   */
  budgetFor(key: string, max?: number): EgressBudget {
    let b = this.budgets.get(key);
    if (!b) {
      b = new EgressBudget(max);
      this.budgets.set(key, b);
    }
    return b;
  }

  /**
   * Perform a default-deny, allowlisted egress request.
   *
   * Enforces, in order:
   *  1. URL parse + scheme allowlist + userinfo denial (URL normalization
   *     also collapses mixed/integer encodings of IP literals).
   *  2. Per-adapter destination allowlist (host + protocol).
   *  3. Literal-IP destination denial (always for adapters).
   *  4. For DNS names: resolve ALL addresses and validate every one (DNS
   *     rebinding / multi-A-record defense in depth).
   *  5. Request budget: wall-clock deadline + concurrency slot.
   *  6. Redirects: each hop re-validated (1-4), capped at maxRedirects.
   */
  async secureFetch(
    input: string | URL | Request,
    init: RequestInit = {},
    opts: SecureFetchOptions = {}
  ): Promise<Response> {
    const egress = opts.egress ?? DEFAULT_ADAPTER_EGRESS;
    const budget = opts.budget ?? DEFAULT_REQUEST_BUDGET;

    const url = typeof input === "string" ? input : input.url;
    const budgetKey = opts.budgetKey ?? "default";

    let parsed;
    try {
      parsed = parseDestination(url, egress.allowedProtocols.length
        ? egress.allowedProtocols
        : undefined);
    } catch (err) {
      if (err instanceof EgressError) throw err;
      const msg = err instanceof Error ? err.message : "bad url";
      throw new EgressError("bad-url", url, msg);
    }

    const { hostname, protocol } = parsed;

    // Per-adapter allowlist (default-deny).
    const policy = checkDestinationPolicy(hostname, protocol, egress);
    if (!policy.ok) {
      throw new EgressError(
        policy.reason!, url,
        `destination '${hostname}' denied by adapter egress policy`
      );
    }

    // Literal IP destination check (belt-and-suspenders for payload-provided
    // URLs that adapters might otherwise pass through).
    const literal = checkIpLiteralDestination(hostname);
    if (literal && !literal.ok) {
      throw new EgressError(
        literal.reason!, url,
        `address '${hostname}' is denied`
      );
    }
    if (literal && literal.ok) {
      // A public literal IP is still not allowlistable; adapters must use
      // DNS names. classifyHostname already rejected it, so throw.
      throw new EgressError("host-not-allowed", url, `IP literal '${hostname}' is not allowlisted`);
    }

    if (!hostMatchesAllowlist(hostname, egress.allowedHosts)) {
      throw new EgressError(
        "host-not-allowed", url,
        `host '${hostname}' not in adapter allowlist`
      );
    }

    // Concurrency budget.
    const tracker = opts.budgetTracker ?? this.budgetFor(
      budgetKey,
      egress.maxConcurrentRequests
    );
    if (!tracker.acquire(budgetKey)) {
      throw new EgressError(
        "budget-exceeded", url,
        "concurrent request budget exceeded"
      );
    }

    try {
      return await this.performWithChecks(
        new URL(url),
        budget,
        opts,
        init,
        0
      );
    } finally {
      tracker.release(budgetKey);
    }
  }

  private async performWithChecks(
    target: URL,
    budget: EgressRequestBudget,
    opts: SecureFetchOptions,
    init: RequestInit,
    redirectCount: number
  ): Promise<Response> {
    if (redirectCount > (budget.maxRedirects ?? DEFAULT_REQUEST_BUDGET.maxRedirects)) {
      throw new EgressError(
        "redirect-deep-limit",
        target.toString(),
        "too many redirects"
      );
    }

    // DNS + deny-list sweep for DNS-name destinations.
    const tgtHost = target.hostname.toLowerCase();
    const literal = checkIpLiteralDestination(tgtHost);
    if (!literal) {
      // It's a DNS name: resolve and validate every address.
      const resolved = await checkResolvedAddresses(
        target.hostname,
        opts.resolver ?? defaultHostResolver
      );
      if (!resolved.ok) {
        throw new EgressError(
          resolved.reason!, target.toString(),
          `resolved addresses for '${target.hostname}' denied`
        );
      }
    } else if (!literal.ok) {
      throw new EgressError(
        literal.reason!, target.toString(),
        `address '${tgtHost}' is denied`
      );
    } else {
      throw new EgressError(
        "host-not-allowed", target.toString(),
        `IP literal '${tgtHost}' is not allowlisted`
      );
    }

    // Re-validate the target against the policy (redirect targets must also
    // be allowlisted).
    const policy = checkDestinationPolicy(
      tgtHost,
      target.protocol.toLowerCase(),
      opts.egress ?? DEFAULT_ADAPTER_EGRESS
    );
    if (!policy.ok) {
      throw new EgressError(
        policy.reason!, target.toString(),
        `redirect/destination '${tgtHost}' denied`
      );
    }
    if (!hostMatchesAllowlist(tgtHost, (opts.egress ?? DEFAULT_ADAPTER_EGRESS).allowedHosts)) {
      throw new EgressError(
        "host-not-allowed", target.toString(),
        `host '${tgtHost}' not in adapter allowlist`
      );
    }

    const transport = opts.transport ?? globalThis.fetch.bind(globalThis);

    const deadlineMs = budget.timeLimitMs ?? DEFAULT_REQUEST_BUDGET.timeLimitMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadlineMs);

    // Combine the caller's abort signal with our deadline signal.
    const effectiveSignal = combineSignals(init.signal, controller.signal);

    let response: Response;
    try {
      response = await transport(target.toString(), {
        ...init,
        signal: effectiveSignal,
        redirect: "manual" as RequestRedirect,
        headers: init.headers ?? {},
      });
    } catch (err) {
      const abortError =
        controller.signal.aborted ? new EgressError(
          "budget-exceeded", target.toString(), "request deadline exceeded"
        ) : null;
      throw abortError ?? err;
    } finally {
      clearTimeout(timeout);
    }

    // Re-validate and follow redirects.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return response;
      }
      response.body?.cancel();
      const next = new URL(location, target);
      if (next.protocol !== "https:" && next.protocol !== "http:") {
        throw new EgressError(
          "scheme-not-allowed", next.toString(),
          "redirect to non-http(s) scheme denied"
        );
      }
      return this.performWithChecks(
        next,
        budget,
        opts,
        init,
        redirectCount + 1
      );
    }

    return response;
  }
}

/** Combine an existing signal with a default-abort deadline signal. */
function combineSignals(
  existing: AbortSignal | null | undefined,
  deadline: AbortSignal
): AbortSignal {
  if (!existing) {
    return deadline;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([existing, deadline]);
  }
  // Fallback: abort deadline when external aborts.
  existing.addEventListener("abort", () => deadline.abort());
  return deadline;
}

const defaultEgressController = new EgressController();

/**
 * Convenience default deny-layer fetch. Agents/adapters that do not need to
 * manage their own controller can route requests through this singleton.
 */
export function secureFetch(
  input: string | URL | Request,
  init?: RequestInit,
  opts?: SecureFetchOptions
): Promise<Response> {
  return defaultEgressController.secureFetch(input, init, opts);
}
