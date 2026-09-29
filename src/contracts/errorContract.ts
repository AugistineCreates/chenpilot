/**
 * Platform-wide error contract.
 *
 * Every controller / service / middleware in the backend should throw an
 * `ApiError` (or one of its subclasses) instead of calling
 * `res.status(...).json(...)` directly. The central error handler in
 * `src/Gateway/middleware/errorHandler.ts` will translate any thrown
 * `ApiError` into a uniform JSON envelope of the shape:
 *
 * ```json
 * {
 *   "success": false,
 *   "status":  404,
 *   "error":   {
 *     "message": "User not found",
 *     "code":    "NOT_FOUND",
 *     "details": "..."   // optional, only present when relevant
 *   }
 * }
 * ```
 *
 * This is the foundation for more accurate docs, safer integrations, and
 * consistent tooling (Swagger, SDK generators, etc.).
 *
 * NOTE: `ApiError` is *intentionally* decoupled from `utils/error.ts`
 * `ApplicationError` so that `src/contracts/` has zero inbound dependencies
 * and can be consumed by any layer. The `errorHandler` knows how to render
 * both shapes; legacy `ApplicationError` subclasses still work.
 */

import type { Response } from "express";

/**
 * Stable, machine-readable error codes that clients can switch on without
 * parsing English messages. New codes should be added here (not invented
 * inline) so SDKs can generate enum bindings.
 */
export enum ApiErrorCode {
  // 4xx
  BAD_REQUEST = "BAD_REQUEST",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  GONE = "GONE",
  RATE_LIMITED = "RATE_LIMITED",
  // 5xx
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  BAD_GATEWAY = "BAD_GATEWAY",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  // Domain-specific
  MISSING_FIELD = "MISSING_FIELD",
  DUPLICATE_ENTRY = "DUPLICATE_ENTRY",
  INVALID_REFERENCE = "INVALID_REFERENCE",
  VALUE_TOO_LONG = "VALUE_TOO_LONG",
  INVALID_DATE_FORMAT = "INVALID_DATE_FORMAT",
  INVALID_INPUT_FORMAT = "INVALID_INPUT_FORMAT",
  CONSTRAINT_VIOLATION = "CONSTRAINT_VIOLATION",
  UNSUPPORTED_OPERATION = "UNSUPPORTED_OPERATION",
  DEPENDENCY_FAILURE = "DEPENDENCY_FAILURE",
}

/**
 * A single field-level validation error (the shape consumed by the
 * platform validation middleware).
 */
export interface ApiValidationFieldError {
  field: string;
  message: string;
  constraints?: Record<string, string>;
  value?: unknown;
}

/**
 * Any structured details payload attached to a response. Kept loose on
 * purpose so domain code can pass through what makes sense.
 */
export type ApiErrorDetails =
  | ApiValidationFieldError[]
  | Record<string, unknown>
  | string
  | undefined;

/**
 * The wire shape returned to clients when a request fails.
 */
export interface ApiErrorResponseBody {
  success: false;
  status: number;
  error: {
    message: string;
    code: ApiErrorCode | string;
    details?: ApiErrorDetails;
    stack?: string;
  };
}

/**
 * Map a status code to a default human-friendly code if the caller did not
 * provide one. Keeps responses sensible when developers pass raw status
 * codes without picking a `ApiErrorCode`.
 */
function defaultCodeForStatus(status: number): ApiErrorCode {
  if (status === 400) return ApiErrorCode.BAD_REQUEST;
  if (status === 401) return ApiErrorCode.UNAUTHORIZED;
  if (status === 403) return ApiErrorCode.FORBIDDEN;
  if (status === 404) return ApiErrorCode.NOT_FOUND;
  if (status === 409) return ApiErrorCode.CONFLICT;
  if (status === 410) return ApiErrorCode.GONE;
  if (status === 422) return ApiErrorCode.VALIDATION_ERROR;
  if (status === 429) return ApiErrorCode.RATE_LIMITED;
  if (status === 501) return ApiErrorCode.NOT_IMPLEMENTED;
  if (status === 502) return ApiErrorCode.BAD_GATEWAY;
  if (status === 503) return ApiErrorCode.SERVICE_UNAVAILABLE;
  return ApiErrorCode.INTERNAL_SERVER_ERROR;
}

/**
 * `ApiError` — the platform-standard thrown error.
 *
 * Anywhere in the backend:
 *
 * ```ts
 * throw ApiError.notFound("User not found");
 * throw ApiError.badRequest("Invalid payload", { field: "amount" });
 * throw ApiError.validationFailed([{ field: "email", message: "must be an email" }]);
 * ```
 *
 * The central `ErrorHandler` middleware will translate this into a
 * consistent JSON envelope.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ApiErrorCode | string;
  public readonly details?: ApiErrorDetails;
  public readonly cause?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code: ApiErrorCode | string = defaultCodeForStatus(statusCode),
    details?: ApiErrorDetails,
    cause?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.cause = cause;
    // Maintain a clean stack trace pointing at the thrower (V8 only).
    if (
      typeof (Error as unknown as { captureStackTrace?: unknown })
        .captureStackTrace === "function"
    ) {
      (
        Error as unknown as {
          captureStackTrace: (target: object, ctor: typeof ApiError) => void;
        }
      ).captureStackTrace(this, ApiError);
    }
  }

  // ---- Static factory helpers ----------------------------------------

  /** 400 — caller sent something we cannot use. */
  static badRequest(
    message = "Bad request",
    details?: ApiErrorDetails
  ): ApiError {
    return new ApiError(message, 400, ApiErrorCode.BAD_REQUEST, details);
  }

  /** 422 — structured validation failure with a list of field errors. */
  static validationFailed(
    details: ApiValidationFieldError[],
    message = "Validation failed"
  ): ApiError {
    return new ApiError(message, 422, ApiErrorCode.VALIDATION_ERROR, details);
  }

  /** 401 — caller is not authenticated. */
  static unauthorized(
    message = "Authentication required",
    details?: ApiErrorDetails
  ): ApiError {
    return new ApiError(message, 401, ApiErrorCode.UNAUTHORIZED, details);
  }

  /** 403 — caller is authenticated but does not have permission. */
  static forbidden(message = "Forbidden", details?: ApiErrorDetails): ApiError {
    return new ApiError(message, 403, ApiErrorCode.FORBIDDEN, details);
  }

  /** 404 — resource does not exist. */
  static notFound(message = "Not found", details?: ApiErrorDetails): ApiError {
    return new ApiError(message, 404, ApiErrorCode.NOT_FOUND, details);
  }

  /** 409 — resource already exists / state conflict. */
  static conflict(message = "Conflict", details?: ApiErrorDetails): ApiError {
    return new ApiError(message, 409, ApiErrorCode.CONFLICT, details);
  }

  /** 410 — resource is gone. */
  static gone(message = "Gone", details?: ApiErrorDetails): ApiError {
    return new ApiError(message, 410, ApiErrorCode.GONE, details);
  }

  /** 429 — caller has been rate limited. */
  static rateLimited(
    message = "Too many requests",
    details?: ApiErrorDetails
  ): ApiError {
    return new ApiError(message, 429, ApiErrorCode.RATE_LIMITED, details);
  }

  /** 500 — generic server error. Avoid leaking implementation details. */
  static internal(
    message = "Internal server error",
    details?: ApiErrorDetails
  ): ApiError {
    return new ApiError(
      message,
      500,
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      details
    );
  }

  /** 501 — feature is not yet implemented in the backend. */
  static notImplemented(
    message = "Not implemented",
    details?: ApiErrorDetails
  ): ApiError {
    return new ApiError(message, 501, ApiErrorCode.NOT_IMPLEMENTED, details);
  }

  /** 503 — upstream dependency failed. */
  static serviceUnavailable(
    message = "Service unavailable",
    details?: ApiErrorDetails
  ): ApiError {
    return new ApiError(
      message,
      503,
      ApiErrorCode.SERVICE_UNAVAILABLE,
      details
    );
  }

  // ---- Rendering -------------------------------------------------------

  /**
   * Serialize this `ApiError` to the canonical JSON envelope. The `stack`
   * is *only* included in non-production environments.
   */
  toResponse(includeStack = false): ApiErrorResponseBody {
    return {
      success: false,
      status: this.statusCode,
      error: {
        message: this.message,
        code: this.code,
        details: this.details,
        stack: includeStack ? this.stack : undefined,
      },
    };
  }

  /**
   * Convenience: render this error directly to an Express response.
   * Returns the `res` for chaining.
   */
  send(res: Response, includeStack = false): Response {
    return res.status(this.statusCode).json(this.toResponse(includeStack));
  }
}

/**
 * Type-narrowing helper for the error handler.
 */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
