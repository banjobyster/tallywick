/**
 * Client IP handling.
 *
 * The raw IP is never stored and never logged. When deduplication or rate
 * limiting needs an identity, the handler hashes the IP with a salt and a
 * window id and keeps a short prefix of the digest.
 */

/** Lower cased hex of `data`. */
function toHex(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Hash an IP into a 32 character token.
 *
 * @param ip client address, or an empty string when unknown
 * @param salt daily rotating salt, or the pinned `IP_SALT`
 * @param windowId a value that changes per dedup or rate window
 */
export async function hashIp(ip: string, salt: string, windowId: string): Promise<string> {
  const input = new TextEncoder().encode(`${ip}|${salt}|${windowId}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return toHex(digest).slice(0, 32);
}

/**
 * Read the client IP from a request using platform trusted headers only.
 * Application supplied forwarding headers are not consulted here.
 */
export function clientIpFromHeaders(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

/** UTC day string like `2026-09-02`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** UTC hour string like `2026-09-02T18`. */
export function utcHour(now: number): string {
  return new Date(now).toISOString().slice(0, 13);
}
