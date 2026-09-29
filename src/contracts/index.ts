/**
 * Public entry point for the platform-wide request validation contracts.
 *
 * Importing from `'../contracts'` (or any path beneath) signals that the
 * caller is talking to the public API surface, not implementation detail.
 *
 *   import { ApiError, ok, validateBody, PaginationQueryDto } from '../contracts';
 *
 * The recommended pattern in a route handler is:
 *
 *   router.post(
 *     '/login',
 *     validateBody(LoginDto),         // 422 on invalid body (auto envelope)
 *     async (req, res) => {
 *       const user = await userService.find(...);
 *       if (!user) throw ApiError.notFound('User not found'); // 404 auto envelope
 *       return ok(res, { user });                              // 200 success envelope
 *     }
 *   );
 *
 * This is the foundation for more accurate docs, safer integrations and
 * a stable wire format that SDK generators and OpenAPI tooling can rely
 * on.
 */

export * from "./errorContract";
export * from "./responseContract";
export * from "./dtos";

// Validation middleware is re-exported here so callers don't need to know
// the legacy `'../Gateway/middleware/validation'` path.
export {
  validateBody,
  validateQuery,
  validateParams,
  validateDto,
  ApiValidationFieldError,
  ValidationErrorResponse,
  formatValidationErrors,
} from "../Gateway/middleware/validation";
