/**
 * Cloudflare Worker entrypoint.
 *
 * The Worker is a thin forwarder. Every request goes to one Durable Object,
 * which owns the SQLite database and runs the shared handler. Set
 * `CF_SHARD_BY_NAMESPACE` to `true` to route each namespace to its own object.
 *
 * Configuration is read from Worker vars and secrets. See docs/configuration.md.
 */

import { TallywickDO } from "./durable_object.ts";

/** Worker environment. Config vars are read by the Durable Object. */
export interface Env {
  TALLYWICK: DurableObjectNamespace;
  CF_SHARD_BY_NAMESPACE?: string;
  [key: string]: unknown;
}

const TARGETED_VERBS = new Set(["hit", "get", "badge", "set", "reset", "delete"]);

function shardName(request: Request, env: Env): string {
  if (String(env.CF_SHARD_BY_NAMESPACE ?? "").toLowerCase() !== "true") return "root";
  let path = new URL(request.url).pathname;
  if (path.startsWith("/v1/")) path = path.slice(3);
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.length >= 2 && TARGETED_VERBS.has(segments[0])) return `ns:${segments[1]}`;
  return "root";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.TALLYWICK.idFromName(shardName(request, env));
    const stub = env.TALLYWICK.get(id);

    const headers = new Headers(request.headers);
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) headers.set("x-tallywick-ip", ip);

    return stub.fetch(new Request(request, { headers }));
  },
};

export { TallywickDO };
