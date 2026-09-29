/**
 * Authentication Middleware
 * Verifies user identity before command execution
 */

import {
  CommandMiddleware,
  TypedCommandContext,
  TypedCommandResult,
  CommandError,
  ErrorCode,
} from '../types.js';

/**
 * Minimal shape this middleware needs from an auth service. Real
 * implementations (e.g. the backend-integration auth service) may expose
 * more, but this is the only method the middleware calls.
 */
export interface AuthService {
  verifyUser(userId: string): Promise<boolean>;
}

export function createAuthMiddleware<TInput>(
  authService: AuthService
): CommandMiddleware<TInput> {
  return async (context: TypedCommandContext<TInput>, next) => {
    try {
      const isAuthenticated = await authService.verifyUser(context.userId);
      
      if (!isAuthenticated) {
        return {
          success: false,
          error: {
            code: 'AUTHENTICATION_FAILED',
            message: 'User not authenticated',
            recoverable: false,
            userMessage: 'Please authenticate first',
          },
        };
      }

      return next();
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'AUTHENTICATION_FAILED',
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        },
      };
    }
  };
}
