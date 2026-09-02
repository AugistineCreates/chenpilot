/**
 * Platform-wide reusable DTOs.
 *
 * Each class here is meant to be passed directly to
 * `validateBody()`, `validateQuery()` or `validateParams()` from
 * `src/Gateway/middleware/validation.ts`. They will throw an
 * `ApiError.validationFailed(...)` automatically if the incoming request
 * does not match the contract.
 *
 * DTOs are *named imports* — do not use the default export.
 */

import { Type, Transform } from "class-transformer";
import {
  IsString,
  IsOptional,
  IsInt,
  IsPositive,
  Min,
  Max,
  MinLength,
  IsDateString,
  IsEnum,
  IsBoolean,
  MaxLength,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsIP,
  IsFQDN,
  IsUUID,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

import {
  IsPositiveIntegerString,
  PaginationDto as _LegacyPaginationDto,
  DateRangeDto as _LegacyDateRangeDto,
} from "../validators";
import { IsStellarAddress } from "../validators/IsStellarPublicKey";
import { BlacklistReason } from "../Security/ipBlacklist.entity";
import { AuditSeverity } from "../AuditLog/auditLog.entity";

// Re-export common decorators so consumers can import them from
// `src/contracts` if they prefer.
export {
  IsString,
  IsOptional,
  IsInt,
  IsPositive,
  Min,
  Max,
  MinLength,
  IsDateString,
  IsEnum,
  IsBoolean,
  MaxLength,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsIP,
  IsFQDN,
  IsUUID,
  IsPositiveIntegerString,
  IsStellarAddress,
  Type,
  Transform,
  IsOptionalBooleanString,
  booleanFromStringTransform,
  // NOTE: `booleanStringTransform` is intentionally NOT re-exported from
  // this barrel — it's a deprecated escape hatch. Import it directly
  // from `src/contracts/dtos` if you really need it; new DTOs should
  // use the `@Transform(booleanFromStringTransform) @IsOptionalBooleanString()`
  // pair instead.
};

/* ------------------------------------------------------------------ */
/*  Shared query-param decorators                                     */
/* ------------------------------------------------------------------ */

/**
 * Coerce a query-string value (`"true"` / `"false"`, case-insensitive)
 * to a boolean. Anything else is passed through unchanged so that the
 * `@IsBoolean` validator (placed alongside) will reject it with a
 * clear `VALIDATION_ERROR` envelope instead of a silent truthy-coerce
 * (the well-known class-transformer footgun).
 *
 * NOTE: This is *transform-only*; it does NOT validate. When used with
 * `enableImplicitConversion: true`, however, class-transformer still
 * truthy-coerces a string like `"garbage"` to `true` BEFORE this
 * transform runs in some versions. For inputs where invalid strings
 * must be rejected, use the dedicated `@IsOptionalBooleanString()`
 * decorator instead.
 */
export function booleanStringTransform({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const v = value.toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  // Pass-through so an explicit `@IsIn(["true", "false"])` (or the
  // dedicated decorator below) can reject it.
  return value;
}

/**
 * Coerce a query-string value (`"true"` / `"false"`, case-insensitive)
 * to a real JavaScript boolean so the DTO field actually contains a
 * boolean (not a string). Stack above `@IsOptionalBooleanString()`:
 *
 * ```ts
 * @IsOptional()
 * @Transform(booleanFromStringTransform)
 * @IsOptionalBooleanString()
 * activeOnly?: boolean;
 * ```
 *
 * Returns:
 *   - undefined / null / empty string → undefined
 *   - boolean true / false             → unchanged
 *   - "true" / "false" (case-insens.)  → true / false
 *   - any other string / non-string    → null (rejected by validator)
 */
export function booleanFromStringTransform({
  value,
}: {
  value: unknown;
}): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return null; // rejected by @IsOptionalBooleanString below
}

/**
 * Validator constraint for `@IsOptionalBooleanString()`. Rejects any
 * value that is not one of: undefined / null / empty string / boolean /
 * case-insensitive "true" / case-insensitive "false".
 *
 * Note: the canonical DTO decoration pattern is the pair
 *   `@Transform(booleanFromStringTransform)` + `@IsOptionalBooleanString()`
 * so that valid inputs are normalised to a real boolean *and* invalid
 * inputs are rejected with a `422 VALIDATION_ERROR` envelope.
 */
@ValidatorConstraint({ async: false })
export class IsOptionalBooleanStringConstraint implements ValidatorConstraintInterface {
  /**
   * Accepts: `undefined`, empty string, true / false (boolean), or a
   * case-insensitive `"true"` / `"false"` string.
   *
   * Notably REJECTS `null`: when paired with
   * `@Transform(booleanFromStringTransform)` (the canonical DTO
   * pattern), `null` is the sentinel produced for non-boolean inputs
   * (e.g. `?activeOnly=garbage`). Allowing `null` would defeat the
   * whole purpose of this validator.
   */
  validate(value: unknown, args: ValidationArguments): boolean {
    void args;
    if (value === undefined || value === "") return true;
    if (typeof value === "boolean") return true;
    if (typeof value !== "string") return false;
    return ["true", "false"].includes(value.toLowerCase());
  }
  defaultMessage(args: ValidationArguments): string {
    void args;
    return "value must be 'true' or 'false' (case-insensitive)";
  }
}

/**
 * Reject any query-string boolean value that isn't exactly `"true"` /
 * `"false"` (case-insensitive). Use this instead of the combination
 * `@IsOptional + @Transform(booleanStringTransform) + @IsBoolean()`
 * because `class-transformer`'s `enableImplicitConversion` will
 * truthy-coerce strings like `"garbage"` to `true` before the
 * `@IsBoolean` validator runs, silently accepting invalid input.
 */
export function IsOptionalBooleanString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isOptionalBooleanString",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsOptionalBooleanStringConstraint,
    });
  };
}

/* ------------------------------------------------------------------ */
/*  Path params                                                       */
/* ------------------------------------------------------------------ */

/** :id — positive integer string. */
export class IdParamDto {
  @IsString()
  @IsPositiveIntegerString()
  id!: string;
}

/** :userId — non-empty string id (DB-assigned). */
export class UserIdParamDto {
  @IsString()
  @MinLength(1)
  userId!: string;
}

/** :sessionId — non-empty session id. */
export class SessionIdParamDto {
  @IsString()
  @MinLength(1)
  sessionId!: string;
}

/** :ip — valid v4 or v6 IP address. */
export class IpAddressParamDto {
  @IsString()
  @IsIP()
  ip!: string;
}

/** :id — UUID v4. */
export class UuidParamDto {
  @IsString()
  @IsUUID()
  id!: string;
}

/* ------------------------------------------------------------------ */
/*  Pagination / date-range query DTOs                                */
/* ------------------------------------------------------------------ */

/**
 * Cursor/limit-style pagination. Both fields optional; `limit` is
 * clamped to a sensible upper bound.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

/**
 * Page-number pagination (`?page=&pageSize=`).
 */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(10_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(500)
  pageSize?: number;
}

/**
 * Inclusive ISO-8601 date range filter. Either bound is optional; the
 * consumer is responsible for asserting `startDate <= endDate`.
 */
export class DateRangeQueryDto extends _LegacyDateRangeDto {}

/* ------------------------------------------------------------------ */
/*  IP blacklist body / query DTOs                                    */
/* ------------------------------------------------------------------ */

/** IP address (v4 / v6) submitted in a JSON body. */
export class IpAddressBodyDto {
  @IsIP()
  ipAddress!: string;
}

/** Body shape for adding an entry to the IP blacklist. */
export class BlacklistAddBodyDto {
  @IsIP()
  ipAddress!: string;

  @IsOptional()
  @IsEnum(BlacklistReason)
  reason?: BlacklistReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

/** Bulk add — capped at 1000 entries per request; each entry is validated as an IP. */
export class BlacklistBulkAddBodyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsIP(undefined, {
    each: true,
    message: "each entry of `ips` must be a valid IP address",
  })
  ips!: string[];

  @IsOptional()
  @IsEnum(BlacklistReason)
  reason?: BlacklistReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/** Query shape for listing the IP blacklist. */
export class BlacklistListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  // See `@IsOptionalBooleanString` JSDoc for why no `@IsOptional()` above.
  @Transform(booleanFromStringTransform)
  @IsOptionalBooleanString()
  activeOnly?: boolean;

  @IsOptional()
  @IsEnum(BlacklistReason)
  reason?: BlacklistReason;
}

/**
 * Query DTO for `GET /api/audit/logs`.
 *
 * Lives in the platform contracts module (alongside
 * `BlacklistListQueryDto`, `PaginationQueryDto`, etc.) rather than in
 * the route file so all query DTOs share one import surface
 * (`src/contracts`) and the test can mount the DTO directly via the
 * public barrel.
 */
export class AuditLogListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsEnum(AuditSeverity, {
    message: "severity must be one of: info, warning, error, critical",
  })
  severity?: AuditSeverity;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  // See `@IsOptionalBooleanString` JSDoc for why no `@IsOptional()` above.
  @Transform(booleanFromStringTransform)
  @IsOptionalBooleanString()
  success?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Re-exports of legacy DTOs (keep old import paths working)        */
/* ------------------------------------------------------------------ */
export { _LegacyPaginationDto as PaginationLimitOffsetDto };
