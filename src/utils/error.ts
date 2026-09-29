/**
 * Backward-compatibility shim for the legacy `ApplicationError` hierarchy.
 *
 * All previously-named error classes (`BadError`, `NotFoundError`,
 * `ConflictError`, `ValidationError`, ...) continue to exist with the same
 * status codes but they now all extend the platform-wide `ApiError`, so
 * the centralised error handler renders every one of them with the same
 * canonical JSON envelope.
 *
 * New code should import from `'../contracts'` directly:
 *
 *   import { ApiError } from '../contracts';
 *   throw ApiError.notFound('User not found');
 *
 * See `docs/PLATFORM_VALIDATION_CONTRACTS.md` for the migration guide.
 */

import { ApiError, ApiErrorCode } from "../contracts/errorContract";

/**
 * @deprecated Use `ApiError` from `src/contracts` directly.
 *
 * This alias is kept so the existing `instanceof ApplicationError`
 * checks in the central error handler continue to work during the
 * migration period.
 */
export class ApplicationError extends ApiError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = "ApplicationError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string, statusCode = 404) {
    super(message, statusCode, ApiErrorCode.NOT_FOUND);
    this.name = "NotFoundError";
  }
}

export class BadError extends ApiError {
  constructor(message: string, statusCode = 400) {
    super(message, statusCode, ApiErrorCode.BAD_REQUEST);
    this.name = "BadError";
  }
}

export class InternalServerError extends ApiError {
  constructor(message: string, statusCode = 500) {
    super(message, statusCode, ApiErrorCode.INTERNAL_SERVER_ERROR);
    this.name = "InternalServerError";
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, statusCode = 409) {
    super(message, statusCode, ApiErrorCode.CONFLICT);
    this.name = "ConflictError";
  }
}

export class RequiredFieldsError extends ApiError {
  constructor(message: string, statusCode = 422) {
    super(message, statusCode, ApiErrorCode.VALIDATION_ERROR);
    this.name = "RequiredFieldsError";
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, statusCode = 422) {
    super(message, statusCode, ApiErrorCode.VALIDATION_ERROR);
    this.name = "ValidationError";
  }
}

export class InvalidPayloadError extends ApiError {
  constructor(message: string, statusCode = 400) {
    super(message, statusCode, ApiErrorCode.BAD_REQUEST);
    this.name = "InvalidPayloadError";
  }
}

export class MissingFieldsError extends ApiError {
  constructor(message: string, statusCode = 400) {
    super(message, statusCode, ApiErrorCode.MISSING_FIELD);
    this.name = "MissingFieldsError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string, statusCode = 403) {
    super(message, statusCode, ApiErrorCode.FORBIDDEN);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string, statusCode = 401) {
    super(message, statusCode, ApiErrorCode.UNAUTHORIZED);
    this.name = "UnauthorizedError";
  }
}

/**
 * Wrap an async controller so thrown errors propagate to the central
 * error handler via `next(err)`.
 */
import express, { NextFunction } from "express";

const RouteErrorHandler =
  (
    fn: (
      req: express.Request,
      res: express.Response,
      next: NextFunction
    ) => Promise<unknown>
  ) =>
  (req: express.Request, res: express.Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch((error) => next(error));

export default RouteErrorHandler;
