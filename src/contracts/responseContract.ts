/**
 * Platform-wide success response contract.
 *
 * Companion to `errorContract.ts`. Together they define the on-the-wire
 * shape of every response this backend produces:
 *
 *   { success: true,  data: T, message?: string }
 *   { success: false, status: N, error: { message, code, details? } }
 *
 * Controllers should prefer the helpers `ok()` / `created()` / `accepted()`
 * / `noContent()` over hand-built `res.status(200).json(...)` blocks.
 *
 * Important: `data` is *only* included in the envelope when defined. This
 * preserves the pre-existing wire shape used by endpoints like
 * `/auth/logout` and `/auth/logout-all` which historically emitted
 * `{ success: true, message: "..." }` *without* a `data` key.
 */

import type { Response } from "express";

/**
 * Canonical success envelope (`data` is omitted when not provided).
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  /** Optional payload. Omitted entirely when `undefined`. */
  data?: T;
  message?: string;
  meta?: Record<string, unknown>;
}

/**
 * Send a 200 OK with a standardized success envelope.
 *
 * `data` is omitted from the body when it is `undefined`. Pass
 * `null` explicitly to send `data: null`.
 *
 * @example
 *   return ok(res, { user });
 *   return ok(res, { user }, "Sessions fetched");
 *   return ok(res, undefined, "Logged out successfully");
 */
export function ok<T>(
  res: Response,
  data?: T,
  message?: string,
  meta?: Record<string, unknown>
): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    ...(data !== undefined ? { data } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(meta !== undefined ? { meta } : {}),
  };
  return res.status(200).json(body);
}

/**
 * Send a 201 Created with a standardized success envelope.
 */
export function created<T>(
  res: Response,
  data?: T,
  message?: string,
  meta?: Record<string, unknown>
): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    ...(data !== undefined ? { data } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(meta !== undefined ? { meta } : {}),
  };
  return res.status(201).json(body);
}

/**
 * Send a 202 Accepted (useful for async workflows).
 */
export function accepted<T>(
  res: Response,
  data?: T,
  message?: string
): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    ...(data !== undefined ? { data } : {}),
    ...(message !== undefined ? { message } : {}),
  };
  return res.status(202).json(body);
}

/**
 * Send a 204 No Content.
 */
export function noContent(res: Response): Response {
  return res.status(204).send();
}

/**
 * Build a success envelope *without* sending it. Useful for return paths
 * (e.g. when wrapping a service response into a response in tests).
 */
export function buildSuccess<T>(
  data?: T,
  message?: string
): ApiSuccessResponse<T> {
  return {
    success: true,
    ...(data !== undefined ? { data } : {}),
    ...(message !== undefined ? { message } : {}),
  };
}
