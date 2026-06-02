# ChenPilot Systems Handbook

This handbook is the contributor-facing map for backend, Soroban, SDK, auth,
migrations, and execution work. Prefer it over scattered implementation notes
when planning platform changes.

## Platform Shape

ChenPilot is a TypeScript backend with Stellar/Soroban contracts and a packaged
SDK for external integrators.

- `src/Gateway` owns HTTP/WebSocket entrypoints, request middleware, webhook
  idempotency, and Horizon proxy routes.
- `src/Auth` owns user identity, JWT and refresh-token flows, roles, preferences,
  and Stellar authentication helpers.
- `src/Agents` owns agent planning, tool execution, sandboxing, registry
  metadata, and execution metrics.
- `src/services/soroban` owns backend Soroban orchestration: SDK compatibility,
  simulation, decoding, signing preparation, TTL/footprint work, invocation, and
  error modeling.
- `contracts` owns Soroban Rust contracts and EVM compatibility contracts.
- `packages/sdk` is the supported external integration surface. Backend modules
  may inspire SDK behavior, but SDK contracts must remain stable and documented.

## Soroban Architecture

The backend Soroban layer is intentionally split into narrow modules:

- `sdkAdapter.ts` centralizes `@stellar/stellar-sdk` namespace/version handling,
  RPC URL resolution, network passphrases, and ScVal conversion.
- `simulator.ts` builds unsigned calls, submits `simulateTransaction`, extracts
  resource estimates, and returns raw simulation details.
- `decoder.ts` converts ScVal return values into native JavaScript models.
- `signingPrep.ts` detects authorization requirements and assembles/signs
  simulated transactions.
- `invoker.ts`, `ttlManager.ts`, `xdrScoping.ts`, `swapLock.ts`, and
  `reentrancyGuard.ts` handle execution and operational guardrails.

Contributor rule: keep SDK compatibility and XDR conversion isolated. New
Soroban behavior should not import directly from `@stellar/stellar-sdk` outside
the adapter unless there is a very specific reason.

## SDK Contract Surface

`packages/sdk/src/contractClient.ts` is the stable client surface for external
builders. It provides:

- Query calls through `ContractClient.query`.
- Simulation calls through `ContractClient.simulate`.
- Execution submission through `ContractClient.execute`.
- Idempotency via explicit `idempotencyKey`, client defaults, or deterministic
  fallback keys.
- Typed decoded result models with `ResultDecoder`, `decodeObject`, and
  `decodeArray`.
- Typed contract bindings through `createContractBinding`.
- Compatibility reports for supported networks and protocol-version ranges.
- First-class simulation UX contracts: fee estimates, auth entries, warnings,
  transaction data XDR, and approval checkpoints.

SDK design rules:

- Keep method names stable once exported from `src/index.ts`.
- Add new typed models rather than widening everything to `unknown`.
- Preserve raw payloads on result objects so advanced integrators can recover
  from RPC shape changes without waiting for a release.
- Mirror backend policy semantics in SDK warnings and approvals, but do not
  expose backend-only service classes as public API.
- When execution submits a transaction, carry an idempotency key.

## Auth And Roles

Auth lives under `src/Auth` and gateway middleware composes access control.

- JWT creation and validation belong in `jwt.service.ts` and
  `auth.middleware.ts`.
- Refresh tokens are persisted through `refreshToken.entity.ts`.
- User roles are represented in `roles.ts` and enforced at route/middleware
  boundaries.
- Stellar identity helpers live in `stellar.service.ts`.

Backend contributors should treat route handlers as policy boundaries. Service
code should receive an already-authenticated user context instead of re-parsing
tokens.

## Execution Flow

A typical contract workflow has these stages:

1. Validate intent and user context at the gateway or agent boundary.
2. Build a Soroban call and run simulation.
3. Decode return values and classify warnings, fees, auth entries, and approval
   checkpoints.
4. Ask the user or caller to approve required checkpoints.
5. Assemble/sign when authorization is required.
6. Submit with idempotency.
7. Persist or emit execution logs, metrics, and audit events.

For SDK integrators, stages 2 through 6 are represented by `ContractClient`.
For backend agent workflows, the same conceptual stages are implemented with
`src/services/soroban` plus agent planner/executor modules.

## Migrations

Database migrations live under `src/migrations` and use timestamp-prefixed
TypeORM migration classes.

Migration rules:

- One behavior change per migration.
- Use explicit column names, indexes, and rollback logic.
- Keep migrations deterministic; avoid reading runtime config except where the
  current datasource setup already requires it.
- Update tests or seed scripts when schema shape affects agent, auth, webhook,
  or audit-log behavior.
- Run the project migration command documented in `RUN_MIGRATION.md` before
  merging schema work.

## Advanced Contributor Checklist

Before opening a PR that changes platform behavior:

- Update SDK types when external payloads or contract results change.
- Add or update tests around decoded models, approvals, idempotency, and
  compatibility behavior.
- Confirm backend Soroban code still routes Stellar SDK access through the
  adapter.
- Document new agent tools in the registry docs when workflow semantics change.
- Include migration notes and rollback behavior for schema changes.
- Add audit or metrics coverage for user-facing execution paths.

## Verification Commands

Common checks:

```bash
npm test
npm run build
cd packages/sdk && npm test
cd packages/sdk && npm run build
```

Contract-specific checks depend on the contract being changed. For Soroban Rust
contracts, run the matching `cargo test` command from the relevant contract
workspace.
