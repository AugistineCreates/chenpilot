import { Request, Response, NextFunction } from "express";

/**
 * Wrap an async controller so thrown errors reach the central
 * `ErrorHandler` middleware via `next(err)` instead of crashing the
 * process or producing an unhandled-promise rejection.
 *
 * Use this for every async route body in the backend:
 *
 *   router.post('/login', validateBody(LoginDto), asyncHandler(async (req, res) => {
 *     ...
 *     throw ApiError.notFound('...');
 *     return ok(res, ...);
 *   }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
