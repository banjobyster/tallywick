/**
 * Behavioural tests for the request handler, against MemoryStore.
 */

// Test assertions read freely off parsed JSON bodies.
// deno-lint-ignore-file no-explicit-any

import { handle } from "../core/handler.ts";
import { parseConfig } from "../core/config.ts";
import { MemoryStore } from "../core/memory_store.ts";
import type { Config, HandlerContext } from "../core/types.ts";
import { assert, assertEquals, assertMatch } from "./assert.ts";

function cfg(env: Record<string, string> = {}): Config {
  return parseConfig(env, { version: "test" }).config;
}

const FIXED = 1_759_000_000_000;

function ctx(over: Partial<HandlerContext> = {}): HandlerContext {
  return {
    now: () => FIXED,
    clientIp: () => "203.0.113.7",
    log: () => {},
    storageLabel: "memory",
    ...over,
  };
}

async function call(
  store: MemoryStore,
  config: Config,
  method: string,
  path: string,
  init: RequestInit = {},
  c: HandlerContext = ctx(),
): Promise<{ status: number; body: any; headers: Headers; text: string }> {
  const res = await handle(
    new Request(`https://t.example${path}`, { method, ...init }),
    store,
    config,
    c,
  );
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers, text };
}

Deno.test("root returns service info", async () => {
  const r = await call(new MemoryStore(), cfg(), "GET", "/");
  assertEquals(r.status, 200);
  assertEquals(r.body.name, "tallywick");
  assertEquals(r.body.version, "test");
});

Deno.test("healthz reports storage label", async () => {
  const r = await call(new MemoryStore(), cfg(), "GET", "/healthz");
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.storage, "memory");
});

Deno.test("hit creates a counter at 1 and increments", async () => {
  const store = new MemoryStore();
  const config = cfg();
  let r = await call(store, config, "GET", "/v1/hit/site/home");
  assertEquals(r.status, 200);
  assertEquals(r.body.count, 1);
  assertEquals(r.body.namespace, "site");
  assertEquals(r.body.key, "home");
  assertEquals(r.headers.get("x-tally-counted"), "true");

  r = await call(store, config, "GET", "/v1/hit/site/home");
  assertEquals(r.body.count, 2);
});

Deno.test("hit without the v1 prefix also works", async () => {
  const r = await call(new MemoryStore(), cfg(), "GET", "/hit/site/home");
  assertEquals(r.status, 200);
  assertEquals(r.body.count, 1);
});

Deno.test("get never creates and returns 0 for unknown", async () => {
  const store = new MemoryStore();
  const config = cfg();
  const r = await call(store, config, "GET", "/v1/get/site/home");
  assertEquals(r.status, 200);
  assertEquals(r.body.count, 0);
  assertEquals(r.body.updated, null);
  assertEquals(await store.read("site/home"), null);
});

Deno.test("by increments by a bounded amount", async () => {
  const store = new MemoryStore();
  const config = cfg({ MAX_INCREMENT: "10" });
  let r = await call(store, config, "POST", "/v1/hit/site/home?by=5");
  assertEquals(r.body.count, 5);
  r = await call(store, config, "POST", "/v1/hit/site/home?by=11");
  assertEquals(r.status, 400);
  assertEquals(r.body.code, "bad_increment");
  r = await call(store, config, "POST", "/v1/hit/site/home?by=0");
  assertEquals(r.status, 400);
  r = await call(store, config, "POST", "/v1/hit/site/home?by=-1");
  assertEquals(r.status, 400);
});

Deno.test("invalid namespace or key is rejected", async () => {
  const config = cfg();
  let r = await call(new MemoryStore(), config, "GET", "/v1/hit/has space/home");
  assertEquals(r.status, 400);
  assertEquals(r.body.code, "bad_namespace");
  r = await call(new MemoryStore(), config, "GET", "/v1/hit/site/" + "x".repeat(65));
  assertEquals(r.status, 400);
  assertEquals(r.body.code, "bad_key");
});

Deno.test("REQUIRE_POST blocks GET on hit", async () => {
  const config = cfg({ REQUIRE_POST: "true" });
  let r = await call(new MemoryStore(), config, "GET", "/v1/hit/site/home");
  assertEquals(r.status, 405);
  assertEquals(r.headers.get("allow"), "POST");
  r = await call(new MemoryStore(), config, "POST", "/v1/hit/site/home");
  assertEquals(r.status, 200);
});

Deno.test("READONLY disables writes but allows reads", async () => {
  const store = new MemoryStore();
  await store.increment("site/home", 4n, FIXED);
  const config = cfg({ READONLY: "true" });
  let r = await call(store, config, "POST", "/v1/hit/site/home");
  assertEquals(r.status, 503);
  assertEquals(r.body.code, "readonly");
  r = await call(store, config, "GET", "/v1/get/site/home");
  assertEquals(r.status, 200);
  assertEquals(r.body.count, 4);
});

Deno.test("AUTO_CREATE off rejects an unknown counter on hit", async () => {
  const store = new MemoryStore();
  const config = cfg({ AUTO_CREATE: "false" });
  let r = await call(store, config, "POST", "/v1/hit/site/home");
  assertEquals(r.status, 403);
  assertEquals(r.body.code, "auto_create_disabled");
  await store.write("site/home", 0n, FIXED);
  r = await call(store, config, "POST", "/v1/hit/site/home");
  assertEquals(r.status, 200);
  assertEquals(r.body.count, 1);
});

Deno.test("MAX_COUNTERS blocks new counters past the cap", async () => {
  const store = new MemoryStore();
  const config = cfg({ MAX_COUNTERS: "2" });
  await call(store, config, "POST", "/v1/hit/s/a");
  await call(store, config, "POST", "/v1/hit/s/b");
  const r = await call(store, config, "POST", "/v1/hit/s/c");
  assertEquals(r.status, 403);
  assertEquals(r.body.code, "limit_reached");
  // existing counter still increments
  const ok = await call(store, config, "POST", "/v1/hit/s/a");
  assertEquals(ok.status, 200);
});

Deno.test("MAX_NAMESPACES blocks a new namespace past the cap", async () => {
  const store = new MemoryStore();
  const config = cfg({ MAX_NAMESPACES: "1" });
  await call(store, config, "POST", "/v1/hit/one/a");
  const sameNs = await call(store, config, "POST", "/v1/hit/one/b");
  assertEquals(sameNs.status, 200);
  const newNs = await call(store, config, "POST", "/v1/hit/two/a");
  assertEquals(newNs.status, 403);
  assertEquals(newNs.body.code, "limit_reached");
});

Deno.test("NAMESPACE_ALLOWLIST restricts namespaces", async () => {
  const config = cfg({ NAMESPACE_ALLOWLIST: "portfolio, bysters" });
  let r = await call(new MemoryStore(), config, "POST", "/v1/hit/portfolio/home");
  assertEquals(r.status, 200);
  r = await call(new MemoryStore(), config, "POST", "/v1/hit/other/home");
  assertEquals(r.status, 400);
  assertEquals(r.body.code, "namespace_not_allowed");
});

Deno.test("dedup ip-day counts once per identity per day", async () => {
  const store = new MemoryStore();
  const config = cfg({ DEDUP: "ip-day" });
  let r = await call(store, config, "GET", "/v1/hit/site/home");
  assertEquals(r.body.count, 1);
  assertEquals(r.headers.get("x-tally-counted"), "true");
  r = await call(store, config, "GET", "/v1/hit/site/home");
  assertEquals(r.body.count, 1);
  assertEquals(r.headers.get("x-tally-counted"), "false");
  // a different IP counts
  r = await call(
    store,
    config,
    "GET",
    "/v1/hit/site/home",
    {},
    ctx({ clientIp: () => "198.51.100.9" }),
  );
  assertEquals(r.body.count, 2);
});

Deno.test("rate limiting returns 429 with Retry-After", async () => {
  const store = new MemoryStore();
  const config = cfg({ RATE_LIMIT: "2", RATE_WINDOW_SECONDS: "60" });
  assertEquals((await call(store, config, "POST", "/v1/hit/s/a")).status, 200);
  assertEquals((await call(store, config, "POST", "/v1/hit/s/a")).status, 200);
  const blocked = await call(store, config, "POST", "/v1/hit/s/a");
  assertEquals(blocked.status, 429);
  assertEquals(blocked.body.code, "rate_limited");
  assert(Number(blocked.headers.get("retry-after")) > 0);
});

Deno.test("IGNORE_BOTS skips counting for a bot user agent", async () => {
  const store = new MemoryStore();
  const config = cfg({ IGNORE_BOTS: "true" });
  const botHeaders = { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } };
  let r = await call(store, config, "GET", "/v1/hit/site/home", botHeaders);
  assertEquals(r.status, 200);
  assertEquals(r.body.count, 0);
  assertEquals(r.headers.get("x-tally-counted"), "false");
  const human = { headers: { "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit Safari" } };
  r = await call(store, config, "GET", "/v1/hit/site/home", human);
  assertEquals(r.body.count, 1);
});

Deno.test("badge returns an svg and never increments", async () => {
  const store = new MemoryStore();
  await store.increment("site/home", 1234n, FIXED);
  const config = cfg();
  const r = await call(store, config, "GET", "/v1/badge/site/home.svg?abbrev=1&label=visitors");
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assertMatch(r.text, /<svg/);
  assertMatch(r.text, /1\.2k/);
  assertMatch(r.text, /visitors/);
  assertEquals((await store.read("site/home"))?.value, 1234n);
});

Deno.test("badge for an unknown counter shows 0", async () => {
  const r = await call(new MemoryStore(), cfg(), "GET", "/v1/badge/site/home.svg");
  assertEquals(r.status, 200);
  assertMatch(r.text, />0<\/text>/);
});

Deno.test("badge with a bad key still returns 200 svg", async () => {
  const r = await call(new MemoryStore(), cfg(), "GET", "/v1/badge/bad key/home.svg");
  assertEquals(r.status, 200);
  assertMatch(r.text, /invalid/);
  assertEquals(r.headers.get("x-tally-status"), "400 bad_namespace");
});

Deno.test("CORS echoes an allowed origin and omits a disallowed one", async () => {
  const config = cfg({ ALLOWED_ORIGINS: "https://banjobyster.github.io" });
  let r = await call(new MemoryStore(), config, "GET", "/v1/get/site/home", {
    headers: { origin: "https://banjobyster.github.io" },
  });
  assertEquals(r.headers.get("access-control-allow-origin"), "https://banjobyster.github.io");
  r = await call(new MemoryStore(), config, "GET", "/v1/get/site/home", {
    headers: { origin: "https://evil.example" },
  });
  assertEquals(r.headers.get("access-control-allow-origin"), null);
});

Deno.test("OPTIONS preflight is answered", async () => {
  const config = cfg({ ALLOWED_ORIGINS: "https://banjobyster.github.io" });
  const r = await call(new MemoryStore(), config, "OPTIONS", "/v1/hit/site/home", {
    headers: { origin: "https://banjobyster.github.io" },
  });
  assertEquals(r.status, 204);
  assertMatch(r.headers.get("access-control-allow-methods") ?? "", /POST/);
});

Deno.test("unknown route is 404 json", async () => {
  const r = await call(new MemoryStore(), cfg(), "GET", "/v1/nope");
  assertEquals(r.status, 404);
  assertEquals(r.body.code, "not_found");
});

Deno.test("admin routes are invisible without ADMIN_TOKEN", async () => {
  const r = await call(new MemoryStore(), cfg(), "GET", "/v1/stats", {
    headers: { authorization: "Bearer whatever" },
  });
  assertEquals(r.status, 404);
});

Deno.test("admin auth rejects a wrong token", async () => {
  const config = cfg({ ADMIN_TOKEN: "a-very-long-admin-token-value" });
  const r = await call(new MemoryStore(), config, "GET", "/v1/stats", {
    headers: { authorization: "Bearer wrong" },
  });
  assertEquals(r.status, 401);
  assertEquals(r.body.code, "unauthorized");
});

Deno.test("admin stats, set, reset, delete, export", async () => {
  const store = new MemoryStore();
  const token = "a-very-long-admin-token-value";
  const config = cfg({ ADMIN_TOKEN: token });
  const auth = { headers: { authorization: `Bearer ${token}` } };

  await call(store, config, "POST", "/v1/hit/site/a", auth);
  await call(store, config, "POST", "/v1/hit/site/b", auth);

  let r = await call(store, config, "POST", "/v1/set/site/a", {
    headers: { ...auth.headers, "content-type": "application/json" },
    body: JSON.stringify({ count: 500 }),
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.count, 500);

  r = await call(store, config, "GET", "/v1/stats", auth);
  assertEquals(r.status, 200);
  assertEquals(r.body.counters, 2);
  assertEquals(r.body.top[0].key, "a");
  assertEquals(r.body.top[0].count, 500);

  r = await call(store, config, "POST", "/v1/reset/site/a", auth);
  assertEquals(r.body.count, 0);

  r = await call(store, config, "GET", "/v1/export", auth);
  assertEquals(r.body.counters.length, 2);

  r = await call(store, config, "DELETE", "/v1/delete/site/b", auth);
  assertEquals(r.body.deleted, true);
  assertEquals(await store.read("site/b"), null);
});

Deno.test("admin import merges and replaces", async () => {
  const store = new MemoryStore();
  const token = "a-very-long-admin-token-value";
  const config = cfg({ ADMIN_TOKEN: token });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  await store.write("site/a", 10n, FIXED);
  let r = await call(store, config, "POST", "/v1/import?mode=merge", {
    headers,
    body: JSON.stringify({
      counters: [{ namespace: "site", key: "a", count: 5 }, {
        namespace: "x",
        key: "y",
        count: "3",
      }],
    }),
  });
  assertEquals(r.body.imported, 2);
  assertEquals((await store.read("site/a"))?.value, 15n);

  r = await call(store, config, "POST", "/v1/import?mode=replace", {
    headers,
    body: JSON.stringify({ counters: [{ namespace: "site", key: "a", count: 1 }] }),
  });
  assertEquals((await store.read("site/a"))?.value, 1n);
});

Deno.test("payload too large is 413", async () => {
  const token = "a-very-long-admin-token-value";
  const config = cfg({ ADMIN_TOKEN: token, MAX_BODY_BYTES: "10" });
  const r = await call(new MemoryStore(), config, "POST", "/v1/set/site/a", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ count: 123456789 }),
  });
  assertEquals(r.status, 413);
});

Deno.test("large counts serialize as a string past 2^53", async () => {
  const store = new MemoryStore();
  await store.write("big/one", 9_007_199_254_740_993n, FIXED);
  const r = await call(store, cfg(), "GET", "/v1/get/big/one");
  assertEquals(r.body.count, "9007199254740993");
  assertEquals(r.body.countString, "9007199254740993");
});
