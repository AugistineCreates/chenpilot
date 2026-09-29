# Platform-Wide Validation Contracts

> Closes [#347 — _Introduce platform-wide request validation contracts_][issue].

This document is the canonical reference for _how_ every controller, service
and middleware in the backend should accept input and produce output. It is
the foundation for more accurate OpenAPI docs, safer SDKs, and a stable
wire format that doesn't drift between endpoints.

[issue]: https://github.com/gear5labs/chenpilot/issues/347

## At a glance

```ts
import {
  ApiError,
  ok,
  created,
  validateBody,
  validateQuery,
  LoginDto,
  PaginationQueryDto,
} from "../contracts";

router.post(
  "/login",
  validateBody(LoginDto), // 422 on invalid body
  async (req, res) => {
    const user = await userSvc.find(req.body.name);
    if (!user) throw ApiError.notFound("User not found"); // 404 automatically
    return ok(res, { user }); // 200 success envelope
  }
);
```

Behind the scenes, `ApiError.notFound(...)` and the validation failure are
both rendered by **the same middleware** (`ErrorHandler`) into the canonical
JSON envelope:

```json
{
  "success": false,
  "status": 404,
  "error": {
    "message": "User not found",
    "code": "NOT_FOUND",
    "details": "..."
  }
}
```

…and every successful response uses the matching envelope:

```json
{ "success": true, "data": { "...": "..." }, "message": "optional" }
```

## Why

Before this change:

| Concern              | Before                                                                                                   | After                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Body validation      | Hand-rolled `if (!field) res.status(400).json(...)` per route                                            | `validateBody(Dto)` middleware – declarative            |
| Query parsing        | Manual `parseInt`, `new Date`, `=== "true"` per route                                                    | `validateQuery(Dto)` with `@Type`, `@Transform`         |
| Error response shape | Inconsistent: `{success:false,message}`, `{success:false,error,message}`, `{success:false,errors:[]}`, … | Single canonical envelope                               |
| Error logging        | Per-route `console.error` / `logger.error` calls                                                         | Routed through `ErrorHandler` for uniform observability |
| SDK generation       | Hard – shapes differ per endpoint                                                                        | Easy – shape is documented and stable                   |

## Architecture

```
            ┌─────────────────────┐
            │ src/contracts/      │   ← public API surface (zero inbound deps)
            │  ├ errorContract.ts │   - ApiError class + factories
            │  ├ responseContract │   - ok/created/noContent
            │  └ dtos.ts          │   - PaginationQueryDto, IdParamDto, …
            └──────────┬──────────┘
                       │ re-export / use
                       ▼
   ┌──────────────────────────────────────────────────────┐
   │ src/Gateway/middleware/errorHandler.ts (terminal)    │
   │   1. err instanceof ApiError → canonical envelope    │
   │   2. err instanceof ApplicationError (legacy)  → …   │
   │   3. err.code is Postgres-style  → friendly code     │
   │   4. err.message                 → pass through     │
   │   5. fallback                     → 500 generic      │
   └──────────────────────────────────────────────────────┘
                       ▲
                       │ throws — never `res.status().json()` directly
                       │
                 Route handlers
```

## `ApiError` — the throwable contract

```ts
import { ApiError, ApiErrorCode } from "../contracts";

// Static factories (status + code are pre-filled):
throw ApiError.badRequest("payload rejected", { field: "amount" }); // 400 BAD_REQUEST
throw ApiError.validationFailed([{ field: "email", message: "..." }]); // 422 VALIDATION_ERROR
throw ApiError.unauthorized(); // 401 UNAUTHORIZED
throw ApiError.forbidden("Only admins can do that"); // 403 FORBIDDEN
throw ApiError.notFound("User not found"); // 404 NOT_FOUND
throw ApiError.conflict("Already exists"); // 409 CONFLICT
throw ApiError.rateLimited("Slow down"); // 429 RATE_LIMITED
throw ApiError.internal(); // 500 INTERNAL_SERVER_ERROR
throw ApiError.serviceUnavailable("Upstream down"); // 503 SERVICE_UNAVAILABLE
```

`ApiError` extends `Error`, so `instanceof Error` still works in catch
blocks. It also extends the _legacy_ `ApplicationError` so the existing
`utils/error.ts` hierarchy (`BadError`, `NotFoundError`, ...) keeps
working unchanged.

## Success helpers

```ts
import { ok, created, noContent } from "../contracts";

return ok(res, data); // 200  { success:true, data }
return ok(res, data, "Sessions loaded");
return created(res, data); // 201  { success:true, data }
return created(res, data, "Created");
return noContent(res); // 204  no body
```

`ok()` and `created()` accept an optional `meta` parameter for things like
pagination cursors or rate-limit counters without polluting the main
payload.

## Validation middleware

```ts
import {
  validateBody, validateQuery, validateParams,
  LoginDto, PaginationQueryDto, IpAddressParamDto,
} from "../contracts";

router.post(
  "/sessions",
  validateBody(LoginDto),                     // – POST /sessions { name }
  async (req, res) => { ... }
);

router.get(
  "/list",
  validateQuery(PaginationQueryDto),          // – ?limit=&offset=&cursor=
  async (req, res) => {
    const { limit, offset, cursor } = req.query as PaginationQueryDto;
    ...
  }
);

router.delete(
  "/ip/:ip",
  validateParams(IpAddressParamDto),          // – /ip/:ip must be v4/v6
  async (req, res) => {
    const { ip } = req.params as IpAddressParamDto;
    ...
  }
);
```

### Conventions for DTOs

1. **Put decorators on the _class_ property**, not the constructor parameter.
2. **Body params** accept whatever JSON the client sends; use
   `class-validator` directly (`@IsString`, `@MinLength`, ...).
3. **Query & params** come in as strings — use:
   - `@Type(() => Number)` for numbers
   - `@Transform` for booleans (esp. `"true"` / `"false"`)
   - `@IsDateString()` for ISO-8601 dates
4. **Always mark optional fields** with `@IsOptional()` so missing fields
   don't 422 unexpectedly.

### Common DTOs (the curated set)

| Name                      | Slot   | Use for                                           |
| ------------------------- | ------ | ------------------------------------------------- |
| `IdParamDto`              | params | `/:id` – positive integer                         |
| `UuidParamDto`            | params | `/:id` – UUID v4                                  |
| `UserIdParamDto`          | params | `/:userId`                                        |
| `SessionIdParamDto`       | params | `/:sessionId`                                     |
| `IpAddressParamDto`       | params | `/:ip` – v4 / v6                                  |
| `PaginationQueryDto`      | query  | `?limit=&offset=&cursor=`                         |
| `PageQueryDto`            | query  | `?page=&pageSize=`                                |
| `DateRangeQueryDto`       | query  | `?startDate=&endDate=`                            |
| `IpAddressBodyDto`        | body   | `POST { ipAddress }`                              |
| `BlacklistAddBodyDto`     | body   | blacklist admin add                               |
| `BlacklistBulkAddBodyDto` | body   | blacklist admin bulk add (≤ 1000 IPs, each v4/v6) |
| `BlacklistListQueryDto`   | query  | blacklist admin list                              |

Add more **here, not ad-hoc in route files**, so SDK generation can read
one place.

## Migration guide (for existing endpoints)

1. **Replace manual validation** with `validateBody(Dto)` / `validateQuery(Dto)`.
   _Old:_ `if (!req.body.name) return res.status(400).json({...})`
   _New:_ class-validator decorators on a DTO; failures become a uniform
   `VALIDATION_ERROR` envelope automatically.

2. **Replace manual error responses** with `throw ApiError.xxx(...)`.
   _Old:_ `return res.status(403).json({ success:false, error:'Forbidden', message:'...' })`
   _New:_ `throw ApiError.forbidden('...')` — same status, canonical envelope.

3. **Replace manual success responses** with `ok(res, data)` / `created(res, data)`.
   _Old:_ `return res.status(200).json({ success:true, ...result })`
   _New:_ `return ok(res, result)` — same shape but uniform + caller can't
   accidentally skip the envelope.

4. **Wrap async route bodies in `asyncHandler`** (or `routeErrorHandler` /
   your framework's equivalent) so `throw`s reach `ErrorHandler`.

5. **Remove now-dead imports** (`BadError`, `NotFoundError`, …) unless you
   actually still use them inside services.

The PR that introduced this contract migrated three reference endpoints
(`src/Auth/auth.routes.ts`, `src/Security/ipBlacklist.routes.ts`,
`src/AuditLog/auditLog.routes.ts`) as worked examples.

## Checklist for new endpoints

- [ ] Every body / query / params field has a DTO with class-validator
      decorators.
- [ ] If the route is async, it's wrapped in `asyncHandler`.
- [ ] Errors are `throw`n via `ApiError.*` — never inline `res.status(...).json`.
- [ ] Success is returned via `ok()` / `created()` / `noContent()`.
- [ ] Doc comment or OpenAPI snippet lists each status the route can return.
- [ ] If a new common DTO shape emerges, it lives in
      `src/contracts/dtos.ts`, not in the route file.

## Backward compatibility

| Old path                                                          | Still works?                           | Newly prefer                                  |
| ----------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| `import { BadError } from '../utils/error'`                       | ✅ (`BadError` now extends `ApiError`) | `import { ApiError } from '../contracts'`     |
| `import { BadRequest } from '../utils/error'`                     | ✅                                     | `ApiError.badRequest(msg)`                    |
| `import { createSuccess } from '../utils/successResponse'`        | ✅                                     | `ok(res, data)`                               |
| `import { validateBody } from '../Gateway/middleware/validation'` | ✅                                     | `import { validateBody } from '../contracts'` |

No existing caller needs to be updated in the same PR; existing routes
keep compiling and emitting the same (or richer) envelope.

> **Wire-format preservation note.** `ok(res, data?, message?)` and
> `created(res, data?, message?)` keep `data` _omitted_ from the body when
> it is `undefined`. The previous `/auth/logout` and `/auth/logout-all`
> routes emitted `{ success: true, message: "..." }` _without_ a `data`
> key — that wire shape is preserved. (If you explicitly pass `null`, it
> is preserved as `data: null`.)

## Testing

- Unit tests live in `tests/unit/platformContracts.test.ts`
  - `ApiError` factories + envelope shape
  - Success helpers (`ok`, `created`, `noContent`, `buildSuccess`)
  - `validateBody` / `validateQuery` / `validateParams` with `supertest`
  - `BlacklistListQueryDto` boolean transform
  - `BlacklistBulkAddBodyDto` per-element IP validation
  - `ErrorHandler` rendering for `ApiError`, legacy `ApplicationError`,
    plain `Error`, and Postgres error code `23505`

## Dependencies

- `class-transformer` is added as a direct root dependency. It was
  previously only installed transitively via `class-validator`, which made
  it unreachable under jest's resolver. The existing
  `src/Gateway/middleware/validation.ts` already used `plainToInstance`
  from `class-transformer`, so this PR is also fixing a latent runtime
  failure for any startup that loads that middleware without first
  importing `class-transformer` directly.
