# Security Audit Report — Issue #106

**Date:** 2026-03-24  
**Scope:** Backend experimental interaction patterns  
**Branch:** `feat/security-audit-106`

---

## Summary

A full review of the backend's interaction patterns was performed covering authentication, LLM prompt handling, webhook ingestion, real-time socket communication, configuration management, and data storage. Four critical issues, four high-severity issues, and five medium-severity issues were identified. Critical and high-priority code fixes have been applied in this branch.

---

## Findings

### CRITICAL

#### C1 — Prompt Injection via Undelimited User Input

- **File:** `src/Agents/agent.ts`
- **Description:** User-controlled input was concatenated directly into the LLM prompt string with no delimiter or escaping, allowing an attacker to override system instructions.
- **Fix applied:** User input is now HTML-entity-escaped and wrapped in `<user_input>` XML delimiters before interpolation, clearly separating data from instructions.

#### C2 — Private Keys Stored in Plaintext

- **File:** `src/Auth/accounts.json`
- **Description:** Private keys are stored in plaintext on disk. Any file-system read (path traversal, misconfigured permissions, backup leak) exposes all keys.
- **Fix required (manual):** Encrypt keys at rest using the existing `ENCRYPTION_KEY` config value before writing to storage. Consider migrating to a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault).

#### C3 — `/api/signup` Accepts Raw Private Keys in Request Body

- **File:** `src/Gateway/routes.ts`
- **Description:** The signup endpoint accepts `pk` (private key) in the HTTP request body. This transmits the key over the wire and logs it in access logs.
- **Fix required (manual):** Private keys should never transit the API. Generate key pairs server-side or accept only the public address and have the client sign a challenge.

#### C4 — Webhook Endpoints Lacked Authentication

- **File:** `src/Gateway/routes.ts`
- **Description:** All three webhook endpoints (Stellar funding, Telegram, Discord) were publicly accessible with no signature verification, allowing spoofed events.
- **Fix applied:** HMAC-SHA256 signature verification middleware (`verifyWebhookSignature`) added to all three endpoints. Set `WEBHOOK_SECRET` in the environment to enforce it in production.

---

### HIGH

#### H1 — JWT Secret Has No Minimum Length Enforcement

- **File:** `src/config/config.ts`
- **Description:** The default JWT secret was `"secret-token"` (12 chars). Short secrets are trivially brute-forceable.
- **Fix applied:** Startup validation now throws if `JWT_SECRET` is shorter than 32 characters.

#### H2 — Socket.io Rooms Joinable Without Authentication

- **File:** `src/Gateway/socketManager.ts`
- **Description:** Any unauthenticated socket could subscribe to `transaction:<id>` or `bot:<id>` rooms and receive sensitive real-time events.
- **Fix applied:** `subscribe:transactions` and `subscribe:bot-alerts` handlers now reject unauthenticated clients with an error event and a warning log.

#### H3 — No Encryption for Private Keys in Database

- **File:** `src/Auth/user.entity` / database layer
- **Description:** The `pk` column is stored as plaintext in PostgreSQL. A database dump exposes all keys.
- **Fix required (manual):** Encrypt the `pk` field using `ENCRYPTION_KEY` before persisting (TypeORM transformer or service layer).

#### H4 — Memory Store Concatenates User Input Without Escaping

- **File:** `src/Agents/memory/memory.ts`
- **Description:** Entries added to the memory store are joined with `\n` and prepended verbatim to future prompts, creating a persistent prompt injection vector across sessions.
- **Fix required (manual):** Sanitize or delimit entries when reading from the store before injecting into prompts (the `<user_input>` delimiter fix in `agent.ts` partially mitigates this for the final user input, but stored memory entries should also be treated as untrusted data).

---

### MEDIUM

#### M1 — CORS Wildcard Origin

- **File:** `src/Gateway/socketManager.ts`
- **Description:** `origin: process.env.ALLOWED_ORIGINS || "*"` defaults to allowing all origins.
- **Recommendation:** Set `ALLOWED_ORIGINS` to an explicit allowlist in all environments.

#### M2 — No Per-User Rate Limiting

- **File:** `src/Gateway/routes.ts`
- **Description:** Rate limiting is per-IP only. Authenticated users behind a shared IP (NAT, proxy) share the same bucket, and a single user can exhaust the limit for others.
- **Recommendation:** Add a secondary rate limiter keyed on `req.user.id` after `authenticateToken`.

#### M3 — Admin IP Whitelist Configured but Not Enforced

- **File:** `src/config/config.ts`, `src/Gateway/middleware/rbac.middleware`
- **Description:** `admin.allowedIps` is populated from the environment but the `requireAdmin` middleware does not check it.
- **Recommendation:** Add an IP check inside `requireAdmin` using `config.admin.allowedIps`.

#### M4 — No Redis TLS

- **File:** `src/config/config.ts`
- **Description:** Redis connection has no `tls` option, transmitting session/cache data in plaintext.
- **Recommendation:** Add `tls: {}` to the Redis config when `NODE_ENV === "production"`.

#### M5 — No Rate Limiting on LLM Calls or Socket.io Events

- **File:** `src/Agents/agent.ts`, `src/Gateway/socketManager.ts`
- **Description:** LLM calls and socket event handlers have no per-user throttle, enabling cost amplification and denial-of-service.
- **Recommendation:** Add a per-agent/per-user token bucket before `callLLM`, and throttle socket event handlers.

---

## Fixes Applied in This Branch

| ID  | File                           | Change                                                 |
| --- | ------------------------------ | ------------------------------------------------------ |
| C1  | `src/Agents/agent.ts`          | Escape and delimit user input with `<user_input>` tags |
| C4  | `src/Gateway/routes.ts`        | HMAC-SHA256 webhook signature verification middleware  |
| H1  | `src/config/config.ts`         | JWT secret minimum length validation at startup        |
| H2  | `src/Gateway/socketManager.ts` | Auth check before room subscription                    |

## Remaining Manual Actions Required

| ID  | Priority | Action                                                                               |
| --- | -------- | ------------------------------------------------------------------------------------ |
| C2  | Critical | Encrypt private keys at rest in `accounts.json`                                      |
| C3  | Critical | Remove `pk` from signup request body; generate server-side or use challenge-response |
| H3  | High     | Encrypt `pk` column in database via TypeORM transformer                              |
| H4  | High     | Delimit/sanitize memory store entries before LLM injection                           |
| M1  | Medium   | Set explicit `ALLOWED_ORIGINS` in all environments                                   |
| M2  | Medium   | Add per-user rate limiter after `authenticateToken`                                  |
| M3  | Medium   | Enforce `admin.allowedIps` inside `requireAdmin` middleware                          |
| M4  | Medium   | Enable Redis TLS in production config                                                |
| M5  | Medium   | Add per-agent throttle on LLM calls and socket events                                |
