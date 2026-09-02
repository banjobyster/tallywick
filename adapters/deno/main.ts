/**
 * Deno Deploy entrypoint.
 *
 * Set configuration through environment variables. See docs/configuration.md.
 * On Deno Deploy, provision a KV database and assign it to the app. Locally,
 * `TALLYWICK_KV_PATH` picks a file, otherwise an in memory KV is used.
 */

import { handle } from "../../core/handler.ts";
import { parseConfig } from "../../core/config.ts";
import type { LogEntry } from "../../core/types.ts";
import { clientIpFromHeaders } from "../../core/ip.ts";
import { DenoKvStore } from "./kv_store.ts";

const VERSION = "0.1.0";

const env = Deno.env.toObject();
const { config, warnings } = parseConfig(env, { version: VERSION });
for (const w of warnings) console.warn(JSON.stringify({ level: "warn", msg: w }));

const kvPath = env.TALLYWICK_KV_PATH || undefined;
const store = await DenoKvStore.open(kvPath);

function log(entry: LogEntry): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
}

function clientIp(req: Request): string | null {
  return clientIpFromHeaders(req);
}

// Periodic no op sweep. Deno KV expires its own keys, so this only exists so a
// future backend that needs it has a hook.
setInterval(() => {
  store.sweep(Date.now()).catch(() => {});
}, 3_600_000);

Deno.serve((req) => handle(req, store, config, { clientIp, log, storageLabel: "deno-kv" }));
