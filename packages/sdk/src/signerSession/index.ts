/**
 * Signer session lifecycle.
 *
 * Adds the connect / reconnect / stale / revoke / downgrade model that
 * `SignatureProvider` alone does not express, uniformly across hardware,
 * browser-extension and mock providers.
 *
 * @example
 * ```ts
 * import { SignerSessionManager, SignerSessionStatus } from "@chen-pilot/sdk-core";
 *
 * const manager = new SignerSessionManager();
 * const session = await manager.open(provider);
 *
 * if (!manager.isUsable(session.id)) {
 *   await manager.reconnect(session.id, provider);
 * }
 * ```
 */

export * from "./types";
export {
  DEFAULT_SESSION_POLICY,
  SignerSessionManager,
  TRANSPORT_SESSION_POLICIES,
  diffCapabilities,
  inferTransport,
  type SignerSessionManagerOptions,
} from "./signerSessionManager";
