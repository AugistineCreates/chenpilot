/**
 * Backward-compatibility shim for the legacy `createSuccess()` helper.
 *
 * New code should import from `src/contracts`:
 *
 *   import { ok, created } from '../contracts';
 *   return ok(res, { user });
 *   return created(res, user, 'User created');
 *
 * This file is kept thin on purpose — it is *just* a re-export so callers
 * that already `import { createSuccess } from '../utils/successResponse'`
 * continue to compile.
 */

import {
  buildSuccess,
  ApiSuccessResponse,
} from "../contracts/responseContract";

export interface SuccessResponse<T = unknown> extends ApiSuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

export function createSuccess<T = unknown>(
  data: T,
  message?: string
): ApiSuccessResponse<T> {
  return buildSuccess(data, message);
}
