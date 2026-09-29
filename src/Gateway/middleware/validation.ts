import { Request, Response, NextFunction } from "express";
import { validate, ValidationError, ValidatorOptions } from "class-validator";
import { plainToInstance, ClassTransformOptions } from "class-transformer";
import logger from "../../config/logger";
import {
  ApiError,
  ApiValidationFieldError,
} from "../../contracts/errorContract";

export type { ApiValidationFieldError };

/**
 * Legacy shape — kept exported so SDK consumers / docs that referenced
 * it continue to compile. Failures are now rendered by the central
 * `ErrorHandler` after the middleware throws `ApiError.validationFailed`.
 */
export interface ValidationErrorResponse {
  success: false;
  error: {
    message: string;
    code: string;
    details: ApiValidationFieldError[];
  };
}

/**
 * Options for the validation middleware.
 */
export interface ValidationOptions {
  /** The DTO class to validate against. */
  dtoClass: new () => object;
  /** Where to read data from (body, query, params). */
  source?: "body" | "query" | "params";
  /** Additional validator options. */
  validatorOptions?: ValidatorOptions;
  /** Additional class-transformer options. */
  transformOptions?: ClassTransformOptions;
  /** Prefix prepended to the thrown error message. */
  messagePrefix?: string;
}

/**
 * Default validator options.
 */
const DEFAULT_VALIDATOR_OPTIONS: ValidatorOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
};

/**
 * Default transform options.
 *
 * `enableImplicitConversion` is intentionally `false`: when it was `true`,
 * class-transformer truthy-coerced strings like `"garbage"` to `true`
 * BEFORE custom validators ran, silently accepting invalid input (the
 * `?activeOnly=garbage` footgun). Every numeric DTO already uses an
 * explicit `@Type(() => Number)` and every boolean DTO uses
 * `@IsOptionalBooleanString()`, so implicit conversion is redundant.
 */
const DEFAULT_TRANSFORM_OPTIONS: ClassTransformOptions = {
  excludeExtraneousValues: false,
  enableImplicitConversion: false,
};

/**
 * `validateBody(DTO)` — validate `req.body` against a class-validator DTO.
 *
 * On failure the middleware throws `ApiError.validationFailed(errors)`,
 * which the central `ErrorHandler` renders to the canonical envelope.
 */
export function validateBody<T extends object>(
  dtoClass: new () => T,
  options?: Partial<Omit<ValidationOptions, "source" | "dtoClass">>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return createValidationMiddleware({
    dtoClass,
    source: "body",
    ...options,
  });
}

/**
 * `validateQuery(DTO)` — validate `req.query` (a record of strings) against
 * a class-validator DTO. Use `@Type(() => Number)` and
 * `@Transform(...)` in the DTO for type coercion off query strings.
 */
export function validateQuery<T extends object>(
  dtoClass: new () => T,
  options?: Partial<Omit<ValidationOptions, "source" | "dtoClass">>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return createValidationMiddleware({
    dtoClass,
    source: "query",
    ...options,
  });
}

/**
 * `validateParams(DTO)` — validate `req.params` (URL path segments).
 */
export function validateParams<T extends object>(
  dtoClass: new () => T,
  options?: Partial<Omit<ValidationOptions, "source" | "dtoClass">>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return createValidationMiddleware({
    dtoClass,
    source: "params",
    ...options,
  });
}

/**
 * Factory that builds the middleware closure.
 */
export function createValidationMiddleware(
  config: ValidationOptions
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const {
    dtoClass,
    source = "body",
    validatorOptions = {},
    transformOptions = {},
    messagePrefix,
  } = config;

  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      // Pass each slot straight through. `req.body` may legitimately
      // be a top-level array (and is normally JSON-parsed with a normal
      // prototype); `req.query` / `req.params` are plain Records.
      const data =
        source === "query"
          ? req.query
          : source === "params"
            ? req.params
            : req.body;

      const dtoInstance = plainToInstance(dtoClass, data as object, {
        ...DEFAULT_TRANSFORM_OPTIONS,
        ...transformOptions,
      });

      const validationErrors = await validate(dtoInstance, {
        ...DEFAULT_VALIDATOR_OPTIONS,
        ...validatorOptions,
      });

      if (validationErrors.length > 0) {
        const details = formatValidationErrors(validationErrors, messagePrefix);

        logger.warn("Validation failed", {
          path: req.path,
          method: req.method,
          source,
          errorCount: validationErrors.length,
          details,
        });

        // Throwing here defers rendering to ErrorHandler so the
        // response uses the *same* envelope as every other error.
        const prefixPart = messagePrefix ? `${messagePrefix}: ` : "";
        const message =
          details.length === 1
            ? `${prefixPart}${details[0].message}`
            : `${prefixPart}Validation failed with ${details.length} error(s)`;

        return next(ApiError.validationFailed(details, message));
      }

      // Replace the slot on `req` with the validated instance so the
      // downstream handler sees the *typed* and *coerced* value.
      //
      // Express 5 makes `req.query` a getter-only property on
      // `IncomingMessage`. A plain `req.query = dto` therefore throws
      // `TypeError: Cannot set property query of #<Request> which has
      // only a getter`. We work around this by redefining the property
      // via `Object.defineProperty`, which shadows the getter and
      // installs our value as a plain data property. `req.params` is
      // normal-assignable but redefining is harmless.
      if (source === "query" || source === "params") {
        Object.defineProperty(req, source, {
          value: dtoInstance,
          enumerable: true,
          configurable: true,
        });
      } else {
        req.body = dtoInstance;
      }

      next();
    } catch (error) {
      // Re-thrown to ErrorHandler — keep as ApiError for consistency.
      logger.error("Validation middleware crashed", {
        error,
        path: req.path,
        method: req.method,
      });
      if (error instanceof ApiError) {
        return next(error);
      }
      if (error instanceof Error) {
        return next(
          ApiError.badRequest(`Invalid ${source} format: ${error.message}`, [])
        );
      }
      next(error);
    }
  };
}

/**
 * Flatten class-validator `ValidationError[]` into a stable list of
 * `{ field, message, constraints?, value? }` items. Recurses into nested
 * object errors using dot-notation paths.
 */
export function formatValidationErrors(
  errors: ValidationError[],
  messagePrefix?: string
): ApiValidationFieldError[] {
  const out: ApiValidationFieldError[] = [];
  const prefix = messagePrefix ? `${messagePrefix}: ` : "";

  for (const err of errors) {
    if (err.children && err.children.length > 0) {
      const nested = formatNestedErrors(err.property, err.children);
      for (const item of nested) {
        out.push({
          ...item,
          message: `${prefix}${item.message}`,
        });
      }
      continue;
    }

    const constraints = err.constraints
      ? Object.entries(err.constraints).reduce(
          (acc, [k, v]) => {
            acc[k] = String(v);
            return acc;
          },
          {} as Record<string, string>
        )
      : undefined;

    out.push({
      field: err.property,
      message: `${prefix}${
        Object.values(err.constraints || {}).join(", ") || "Invalid value"
      }`,
      constraints,
      value: err.value as unknown,
    });
  }

  return out;
}

function formatNestedErrors(
  parentProperty: string,
  children: ValidationError[]
): ApiValidationFieldError[] {
  const out: ApiValidationFieldError[] = [];
  for (const err of children) {
    const fullPath = `${parentProperty}.${err.property}`;
    if (err.children && err.children.length > 0) {
      out.push(...formatNestedErrors(fullPath, err.children));
      continue;
    }
    const constraints = err.constraints
      ? Object.entries(err.constraints).reduce(
          (acc, [k, v]) => {
            acc[k] = String(v);
            return acc;
          },
          {} as Record<string, string>
        )
      : undefined;
    out.push({
      field: fullPath,
      message:
        Object.values(err.constraints || {}).join(", ") || "Invalid value",
      constraints,
      value: err.value as unknown,
    });
  }
  return out;
}

/**
 * Utility to validate a DTO without using it as middleware — useful in
 * services that need to gate inputs to internal calls.
 */
export async function validateDto<T extends object>(
  dtoClass: new () => T,
  data: unknown,
  options?: Partial<ValidationOptions>
): Promise<{
  valid: boolean;
  errors?: ApiValidationFieldError[];
  instance?: T;
}> {
  const dtoInstance = plainToInstance(
    dtoClass,
    data as object,
    DEFAULT_TRANSFORM_OPTIONS
  );
  const validationErrors = await validate(dtoInstance, {
    ...DEFAULT_VALIDATOR_OPTIONS,
    ...options?.validatorOptions,
  });
  if (validationErrors.length > 0) {
    return {
      valid: false,
      errors: formatValidationErrors(validationErrors),
    };
  }
  return { valid: true, instance: dtoInstance };
}
