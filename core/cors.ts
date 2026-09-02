/**
 * Cross origin resource sharing.
 *
 * The service replies with `Access-Control-Allow-Origin` only when the request
 * `Origin` matches `ALLOWED_ORIGINS`. It never enables credentialed mode.
 */

import type { Config, OriginRule } from "./types.ts";

/** True when `origin` is permitted by the rules. */
export function originAllowed(origin: string, rules: OriginRule[]): boolean {
  const o = origin.replace(/\/+$/, "").toLowerCase();
  for (const rule of rules) {
    if (rule.any) return true;
    if (rule.exact && rule.exact === o) return true;
    if (rule.suffix) {
      try {
        const host = new URL(o).host;
        if (host === rule.suffix.slice(1) || host.endsWith(rule.suffix)) return true;
      } catch {
        // origin is not a URL, no match
      }
    }
  }
  return false;
}

/**
 * Headers to merge into a response for the given request origin. Returns the
 * echo origin plus `Vary`, or an empty object when the origin is not allowed.
 */
export function corsHeaders(request: Request, config: Config): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  if (!originAllowed(origin, config.allowedOrigins)) return { "vary": "Origin" };
  const anyRule = config.allowedOrigins.some((r) => r.any);
  return {
    "access-control-allow-origin": anyRule ? "*" : origin,
    "vary": "Origin",
  };
}

/** Full preflight response for an `OPTIONS` request. */
export function preflight(request: Request, config: Config): Response {
  const headers = new Headers(corsHeaders(request, config));
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Authorization, Content-Type");
  headers.set("access-control-max-age", String(config.corsMaxAge));
  return new Response(null, { status: 204, headers });
}
