/**
 * Input Validation Middleware
 * Validates input against schema before command execution
 */

import {
  CommandMiddleware,
  TypedCommandContext,
  TypedCommandResult,
  CommandError,
  ErrorCode,
} from '../types.js';

/**
 * Structural subset of a Zod (or Zod-like) schema. Only `.parse()` is used,
 * so callers can pass a real Zod schema, a hand-rolled validator, or any
 * object shaped like one without this package depending on `zod` directly.
 */
export interface ParseableSchema<TInput> {
  parse(input: unknown): TInput;
}

export function createValidationMiddleware<TInput>(
  schema?: ParseableSchema<TInput>
): CommandMiddleware<TInput> {
  return async (context: TypedCommandContext<TInput>, next) => {
    try {
      // If schema has a parse method (like Zod), use it
      if (schema && typeof schema.parse === 'function') {
        schema.parse(context.input);
      }
      
      return next();
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
          userMessage: 'Invalid input. Please check your parameters.',
        },
      };
    }
  };
}
