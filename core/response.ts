/**
 * Response helpers. Every JSON reply is uncached and nosniff.
 */

import type { CounterRecord } from "./types.ts";

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

/** Known machine readable error codes. */
export type ErrorCode =
  | "not_found"
  | "method_not_allowed"
  | "bad_namespace"
  | "bad_key"
  | "bad_increment"
  | "bad_body"
  | "namespace_not_allowed"
  | "origin_not_allowed"
  | "auto_create_disabled"
  | "limit_reached"
  | "unauthorized"
  | "rate_limited"
  | "readonly"
  | "payload_too_large"
  | "storage_unavailable"
  | "internal";

/** Serialize a counter for the wire, widening past 2^53 to a string. */
export function counterBody(
  namespace: string,
  key: string,
  rec: CounterRecord,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    namespace,
    key,
    count: rec.value <= 9_007_199_254_740_991n ? Number(rec.value) : rec.value.toString(),
    updated: new Date(rec.updatedAt).toISOString(),
  };
  if (rec.value > 9_007_199_254_740_991n) body.countString = rec.value.toString();
  return body;
}

/** A JSON success response. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(BASE_HEADERS);
  for (const [k, v] of Object.entries(init.headers ?? {})) headers.set(k, v as string);
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** A JSON error response with `error` and `code`. */
export function errorJson(
  status: number,
  code: ErrorCode,
  message: string,
  init: ResponseInit = {},
): Response {
  return json({ error: message, code }, { ...init, status });
}

/** Merge extra headers into an existing response without losing the body. */
export function withHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
