# Type Safety Cleanup Program

This repo enforces `@typescript-eslint/no-explicit-any` (see `eslint.config.mjs`),
currently at `warn` severity repo-wide. This document tracks progress on
removing `any` from the highest-risk code paths — request/webhook handling,
auth, bot adapters, and SDK public surface — and gives contributors a
prioritized map of what's left.

## How this is enforced

`eslint.config.mjs` has a second override block that raises
`@typescript-eslint/no-explicit-any` to `error` for paths that have been
fully cleaned. As you clean a directory, add it to that `files` array so it
can't silently regress. Don't add a path until `grep -rn ": any\b\|as any\b\|<any>" <path>`
comes back empty for real code (test files are exempt).

## Already cleaned (error-level enforcement)

- `packages/bot/src/permissions/**` — the permission matrix, backend/platform
  role integrations, and command-guard middleware. Fixing this surfaced two
  live bugs, not just type holes:
  - `middleware.ts` reached into `PermissionMatrix`'s private
    `determineUserPermissionLevel` and two already-public constants
    (`PermissionLevelHierarchy`, `CapabilityPermissionRequirements`) via
    `(x as any)`, instead of importing the constants directly. Added a public
    `PermissionMatrix.getUserPermissionLevel()` wrapper for the one genuinely
    private piece it needed.
  - `backendIntegration.ts` cast the entire `get_user` backend response to
    `any`. Typed it via `executeCommand<TInput, TOutput>`'s existing generics
    instead of casting after the fact.
- `packages/bot/src/commands/middleware/{auth,rateLimit,validation}.ts` — the
  three command-guard middlewares. Each took `any` where the existing
  `CommandMiddleware<TInput>` generic already covered the real type; made
  the factory functions themselves generic instead.
- `packages/bot/src/commands/services/BackendClient.ts` — `executeWorkflow`
  now mirrors the already-generic `executeCommand<TInput, TOutput>` instead
  of returning `Promise<any>`.
- `packages/bot/src/moderation/**`, `packages/bot/src/commands/adapters/telegramModeration.ts` —
  new code (moderation policy engine + adapters), written `any`-free from
  the start.
- `packages/sdk/src/xdrDecoder.ts` — every operation-body cast
  (`op as any`) replaced with the SDK's real generated `xdr.*Op` classes
  (`@stellar/stellar-base`'s `.d.ts` has full types for these; the casts
  predate that, or were never updated). This surfaced two real bugs:
  1. `getAssetDesc()` called `.assetCode()`/`.issuer()` directly on
     `xdr.Asset`, but those methods only exist on the `.alphaNum4()` /
     `.alphaNum12()` sub-object — so decoding any non-native-asset payment,
     offer, claimable balance, clawback, or trustline-flags operation threw
     at runtime and silently fell into the `catch` block's generic
     "Failed to decode operation" message. Fixed to read the sub-object.
  2. The `changeTrust` case checked
     `line.switch() === (xdr as any).ChangeTrustAssetType?.changeTrustAssetTypeNative?.()`.
     `ChangeTrustAssetType` doesn't exist on the SDK at all (confirmed at
     runtime) — the optional chaining always resolved to `undefined`, so the
     native-XLM branch was permanently dead code. Fixed to compare against
     `xdr.AssetType.assetTypeNative()`, the same discriminant `Asset` uses.
  3. As a side effect of wrapping every `switch` case in its own block
     scope (needed to narrow `op` per-case with real types), this file also
     now passes `tsc --noEmit`, which it did not before — the unbraced
     `switch` cases redeclared `const asset`, `amount`, `assetDesc`, etc.
     across cases (`TS2451: Cannot redeclare block-scoped variable`).

## Remaining hotspots, by risk tier

### Tier 1 — bot adapters (highest risk: parses live platform events)

- `packages/bot/src/adapters/telegram.ts` (18) and
  `packages/bot/src/adapters/discord.ts` (10) — **do not start here.** Both
  files are currently corrupted (duplicated imports, duplicated command
  handlers, mismatched braces — see e.g. `adapters/telegram.ts` lines
  1–30 and 300–340) and do not compile as committed. `packages/bot/src/index.ts`
  still instantiates adapters from these two files rather than the newer
  `packages/bot/src/discord/DiscordAdapter.ts` module. Fixing the
  duplication is a prerequisite for any `any` cleanup here and is a
  substantial, separate effort — restoring these to a single coherent
  implementation (likely by diffing against an earlier commit or the
  `discord/DiscordAdapter.ts` rewrite) should be its own issue.
- `packages/bot/src/discord/DiscordAdapter.ts` (3 remaining) —
  `handleInteraction`/`handleButtonInteraction`/`handleCommandInteraction`
  take `interaction: any`. These are real discord.js `Interaction` variants
  narrowed via `.isButton()`/`.isChatInputCommand()` type guards; typing them
  as `ButtonInteraction | ChatInputCommandInteraction | ...` and switching to
  a proper discriminated match is straightforward but touches every
  interaction-handling method together, so it's sized as its own follow-up
  rather than folded into this pass.
- `packages/bot/src/discord/stateMachine/engine.ts` (6),
  `packages/bot/src/discord/modules/interaction/types.ts` (3),
  `packages/bot/src/discord/services/DiscordBackendIntegration.ts` (2),
  `packages/bot/src/notification/handlers/{discord,telegram}Handler.ts` (2 each) —
  same family of problem (raw platform SDK objects passed around as `any`
  instead of the SDK's real types); not yet audited in depth.

### Tier 2 — SDK public surface

- `packages/sdk/src/assetIntelligence/MigrationAdapter.ts` (11) — largest
  remaining concentration in the SDK. Not yet audited.
- `packages/sdk/src/sponsorship.ts` (6) — skipped deliberately in this pass.
  `npm run type-check` in `packages/sdk` shows this file already fails to
  compile for reasons unrelated to `any` (e.g. `Operation` used as generic
  when it isn't, `Timebounds`/`RevokeSponsorshipOp` not exported by the
  installed `@stellar/stellar-sdk` version, `revokeSponsorship` vs the SDK's
  actual `revokeDataSponsorship`). The `any` usages here are downstream of
  those mismatches; fixing them needs the SDK version/API drift resolved
  first, not just the casts removed.
- `packages/sdk/src/memoUtils.ts` (3), `NetworkIntelligence.ts` (2),
  `assetIntelligence/cache/MemoryCache.ts` (2), `recovery.ts` (1),
  `metadata.ts` (1), `assetIntelligence/core/types.ts` (1) — smaller,
  not yet audited.

### Tier 3 — command framework internals

- `packages/bot/src/commands/types.ts` (9) — the shared interface file
  (`CommandContract.inputSchema?: any`, `outputSchema?: any`,
  `CommandError.details?: Record<string, any>`,
  `CommandMiddleware`'s `next(): Promise<TypedCommandResult<any>>`, etc.).
  Deliberately left alone: these are the root definitions that
  `commands/contracts/CommandContract.ts` and the three middleware files
  above already conform to. Changing them is a larger, cascading change
  (schema validation needs a real minimal type — see
  `commands/middleware/validation.ts`'s `ParseableSchema<TInput>` for the
  pattern to reuse — and the middleware chain's `any` is structurally tied
  to letting middleware transform the result type, which needs a real
  design decision, not a mechanical cast removal).
- `packages/bot/src/commands/contracts/CommandContract.ts` (5 remaining) —
  same root cause as above (`inputSchema`/`outputSchema`/`details`/
  `executeNext`'s accumulator type all trace back to `types.ts`).
- `packages/bot/src/commands/workflows/WorkflowEngine.ts` (3) — two of these
  (`Map<string, Workflow<any>>`, `Map<string, WorkflowInstance<any>>`) are a
  defensible type-erased heterogeneous registry — the public API
  (`register<TState>`, `start<TState>`, `executeStep<TState>`) is already
  properly generic, and callers never see the internal `any`. The third
  (`executeStep(instanceId, input: any)`) mirrors `Workflow<TState>`'s
  `handler: (state: TState, input: any) => ...` in `types.ts`, which has no
  `TInput` generic parameter today — adding one is a real interface change,
  not a local fix.
- `packages/bot/src/commands/adapters/telegramAdapter.ts` (3) — not yet
  audited.

### Tier 4 — misc / lower risk

- `src/Agents/tools/defi/{YieldBloxAdapter,EquilibreAdapter}.ts` (4 + 3),
  `src/utils/resilience.ts` (2), `src/Gateway/middleware/rbac.middleware.ts` (1),
  `src/Gateway/capabilities/capability.service.ts` (1),
  `src/Auth/botIdentity.service.ts` (1),
  `packages/bot/src/{types.ts,performanceProfiler.ts,observability/botContext.ts,notification/monitoring.ts}` (1–3 each) —
  smaller counts, not yet audited. `src/Gateway/middleware/`,
  `src/Auth/`, and the webhook-handling files (`src/Gateway/webhook*.ts`,
  `platformWebhook.service.ts`) are worth prioritizing next given they sit
  directly on request/auth boundaries, even though their current `any`
  count is low.

## Suggested order for the next pass

1. `src/Gateway/middleware/rbac.middleware.ts`, `src/Auth/botIdentity.service.ts`,
   `src/Gateway/capabilities/capability.service.ts` — small, auth-adjacent,
   quick wins.
2. `packages/bot/src/discord/DiscordAdapter.ts`'s remaining interaction
   handlers — same file already touched in this pass, natural continuation.
3. `packages/sdk/src/assetIntelligence/MigrationAdapter.ts` — largest single
   remaining SDK file.
4. Untangling `packages/bot/src/adapters/{discord,telegram}.ts` — bigger,
   should be scoped as its own issue given the duplication has to be fixed
   before typing makes sense.
