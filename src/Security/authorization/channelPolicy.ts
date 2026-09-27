/**
 * Channel-independent authorization contract.
 *
 * Every entry point (HTTP, WebSocket, bot, background job) resolves the same
 * base decision from the principal alone. A channel may only *remove*
 * authority via its restriction list — it can never grant an operation the
 * principal does not already hold. Jobs authorize as their originating
 * principal, so work enqueued by a user cannot run with more authority than
 * the user had.
 */

export type Channel = "http" | "websocket" | "bot" | "job";

export interface Principal {
  id: string;
  /** Operations this principal is granted, e.g. "payment:send". */
  grants: readonly string[];
  /** Set when the principal is suspended; overrides every grant. */
  suspended?: boolean;
}

export interface ChannelPolicy {
  /** Operations this channel refuses even for a granted principal. */
  denied: readonly string[];
}

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: "suspended" | "not_granted" | "channel_restricted" | "missing_origin" };

/** Default per-channel restrictions. Channels may only narrow authority. */
export const DEFAULT_CHANNEL_POLICIES: Record<Channel, ChannelPolicy> = {
  http: { denied: [] },
  websocket: { denied: [] },
  bot: { denied: ["admin:*"] },
  job: { denied: [] },
};

function matches(pattern: string, operation: string): boolean {
  if (pattern.endsWith(":*")) return operation.startsWith(pattern.slice(0, -1));
  return pattern === operation;
}

/** Channel-independent decision: depends only on the principal and operation. */
export function baseDecision(principal: Principal, operation: string): Decision {
  if (principal.suspended) return { allowed: false, reason: "suspended" };
  if (!principal.grants.some((g) => matches(g, operation))) {
    return { allowed: false, reason: "not_granted" };
  }
  return { allowed: true };
}

export function authorize(
  principal: Principal,
  operation: string,
  channel: Channel,
  policies: Record<Channel, ChannelPolicy> = DEFAULT_CHANNEL_POLICIES,
): Decision {
  const base = baseDecision(principal, operation);
  if (!base.allowed) return base;
  if (policies[channel].denied.some((d) => matches(d, operation))) {
    return { allowed: false, reason: "channel_restricted" };
  }
  return base;
}

/** Identity and policy context captured when a job is enqueued. */
export interface JobAuthContext {
  originPrincipal: Principal;
  originChannel: Exclude<Channel, "job">;
}

/**
 * Authorizes job execution as the originating principal. The origin channel's
 * restrictions still apply, so a job cannot escape them by being deferred.
 */
export function authorizeJob(
  context: JobAuthContext | undefined,
  operation: string,
  policies: Record<Channel, ChannelPolicy> = DEFAULT_CHANNEL_POLICIES,
): Decision {
  if (!context?.originPrincipal) return { allowed: false, reason: "missing_origin" };
  const origin = authorize(context.originPrincipal, operation, context.originChannel, policies);
  if (!origin.allowed) return origin;
  return authorize(context.originPrincipal, operation, "job", policies);
}
