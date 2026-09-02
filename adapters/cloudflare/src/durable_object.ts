/**
 * The Durable Object that owns the counter database.
 *
 * It builds a {@link SqliteStore} over its own SQLite storage and runs the
 * shared handler. An hourly alarm clears expired dedup, rate, and salt rows.
 */

import { DurableObject } from "cloudflare:workers";
import { handle } from "../../../core/handler.ts";
import { parseConfig } from "../../../core/config.ts";
import type { Config } from "../../../core/types.ts";
import { SqliteStore } from "./sqlite_store.ts";
import type { Env } from "./worker.ts";

const VERSION = "0.1.0";
const SWEEP_INTERVAL_MS = 3_600_000;

export class TallywickDO extends DurableObject<Env> {
  #store: SqliteStore;
  #config: Config | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#store = new SqliteStore(ctx.storage.sql);
    this.#store.migrate();
    ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
      }
    });
  }

  #resolveConfig(): Config {
    if (!this.#config) {
      const { config, warnings } = parseConfig(
        this.env as unknown as Record<string, string | undefined>,
        { version: VERSION },
      );
      for (const w of warnings) console.warn(JSON.stringify({ level: "warn", msg: w }));
      this.#config = config;
    }
    return this.#config;
  }

  override fetch(request: Request): Promise<Response> {
    let config: Config;
    try {
      config = this.#resolveConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "configuration error";
      return Promise.resolve(
        new Response(JSON.stringify({ error: msg, code: "internal" }), {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      );
    }
    return handle(request, this.#store, config, {
      clientIp: (req) =>
        req.headers.get("x-tallywick-ip") ?? req.headers.get("cf-connecting-ip"),
      storageLabel: "cloudflare-do-sqlite",
    });
  }

  override async alarm(): Promise<void> {
    await this.#store.sweep(Date.now());
    await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }
}
