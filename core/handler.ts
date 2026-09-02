/**
 * The request handler.
 *
 * `handle` is the whole service. It takes a web `Request`, a {@link Store}, a
 * {@link Config}, and an optional {@link HandlerContext}, and returns a
 * `Response`. It imports no runtime API. Adapters wire it to a platform.
 */

import type { Config, HandlerContext, LogEntry, Store } from "./types.ts";
import { corsHeaders, preflight } from "./cors.ts";
import { counterBody, errorJson, json, withHeaders } from "./response.ts";
import { parseIncrement, splitName, validateName } from "./validate.ts";
import { clientIpFromHeaders, hashIp, utcDay, utcHour } from "./ip.ts";
import { isBot } from "./bots.ts";
import { abbreviate, type BadgeStyle, renderBadge } from "./badge.ts";
import { fnv1a, secretsMatch } from "./hash.ts";

const SALT_TTL_SECONDS = 172_800; // two days

/** Handle one request. Never throws. */
export async function handle(
  request: Request,
  store: Store,
  config: Config,
  ctx: HandlerContext = {},
): Promise<Response> {
  const started = (ctx.now ?? Date.now)();
  const log = makeLogger(config, ctx);

  let response: Response;
  let logEntry: Partial<LogEntry> = {};
  try {
    const result = await route(request, store, config, ctx, started);
    response = result.response;
    logEntry = result.log ?? {};
  } catch (err) {
    log({
      level: "error",
      msg: "unhandled error",
      err: err instanceof Error ? err.message : String(err),
    });
    response = errorJson(500, "internal", "internal error");
  }

  const isBadge = new URL(request.url).pathname.includes("/badge/");
  response = isBadge
    ? withHeaders(response, { "access-control-allow-origin": "*" })
    : withHeaders(response, corsHeaders(request, config));

  log({
    level: response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info",
    msg: "request",
    route: logEntry.route,
    status: response.status,
    namespace: logEntry.namespace,
    key: logEntry.key,
    counted: logEntry.counted,
    bot: logEntry.bot,
    durMs: (ctx.now ?? Date.now)() - started,
  });

  return response;
}

interface RouteResult {
  response: Response;
  log?: Partial<LogEntry>;
}

function route(
  request: Request,
  store: Store,
  config: Config,
  ctx: HandlerContext,
  now: number,
): RouteResult | Promise<RouteResult> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return { response: preflight(request, config), log: { route: "options" } };
  }

  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.startsWith("/v1/")) path = path.slice(3);
  else if (path === "/v1") path = "/";

  const segments = path.split("/").filter((s) => s.length > 0);

  if (segments.length === 0) return { response: rootInfo(config), log: { route: "root" } };
  if (segments.length === 1 && segments[0] === "healthz") {
    return { response: health(config, ctx), log: { route: "healthz" } };
  }

  const verb = segments[0];

  if (verb === "hit" || verb === "get" || verb === "badge") {
    const parsed = parseTarget(verb, segments);
    if (!parsed) return { response: notFound(), log: { route: verb } };
    const { namespace: rawNs, key: rawKey } = parsed;
    const decoded = decodeSegments(rawNs, rawKey);
    if (!decoded) {
      return {
        response: errorJson(400, "bad_key", "namespace or key is not valid url text"),
        log: { route: verb },
      };
    }
    if (verb === "badge") return badgeRoute(url, store, config, decoded.namespace, decoded.key);
    if (verb === "get") return getRoute(method, store, config, decoded.namespace, decoded.key);
    return hitRoute(request, url, method, store, config, ctx, now, decoded.namespace, decoded.key);
  }

  if (["stats", "export", "import", "set", "reset", "delete"].includes(verb)) {
    return adminRoute(request, url, method, verb, segments, store, config, now);
  }

  return { response: notFound(), log: { route: "unknown" } };
}

// ----------------------------------------------------------------------------
// public routes
// ----------------------------------------------------------------------------

function rootInfo(config: Config): Response {
  return json({
    name: "tallywick",
    version: config.version,
    docs: "https://github.com/banjobyster/tallywick",
    routes: {
      hit: "GET|POST /v1/hit/:namespace/:key",
      get: "GET /v1/get/:namespace/:key",
      badge: "GET /v1/badge/:namespace/:key.svg",
    },
  });
}

function health(config: Config, ctx: HandlerContext): Response {
  return json({ ok: true, version: config.version, storage: ctx.storageLabel ?? "unknown" });
}

function getRoute(
  method: string,
  store: Store,
  config: Config,
  namespace: string,
  key: string,
): Promise<RouteResult> {
  if (method !== "GET") return Promise.resolve({ response: methodNotAllowed("GET") });
  const check = validateName(namespace, key, config);
  if (!check.ok) {
    return Promise.resolve({
      response: errorJson(400, check.code, `${check.field} does not match the allowed pattern`),
      log: { route: "get", namespace, key },
    });
  }
  return store.read(check.name).then((rec) => ({
    response: json(
      rec ? counterBody(namespace, key, rec) : { namespace, key, count: 0, updated: null },
    ),
    log: { route: "get", namespace, key },
  }));
}

async function hitRoute(
  request: Request,
  url: URL,
  method: string,
  store: Store,
  config: Config,
  ctx: HandlerContext,
  now: number,
  namespace: string,
  key: string,
): Promise<RouteResult> {
  const logBase: Partial<LogEntry> = { route: "hit", namespace, key };

  const allowedMethods = config.requirePost ? ["POST"] : ["GET", "POST"];
  if (!allowedMethods.includes(method)) {
    return { response: methodNotAllowed(allowedMethods.join(", ")), log: logBase };
  }
  if (config.readOnly) {
    return { response: errorJson(503, "readonly", "counter writes are disabled"), log: logBase };
  }

  const check = validateName(namespace, key, config);
  if (!check.ok) {
    return {
      response: errorJson(400, check.code, `${check.field} does not match the allowed pattern`),
      log: logBase,
    };
  }
  const name = check.name;

  const ip = (ctx.clientIp?.(request) ?? clientIpFromHeaders(request)) ?? "";
  let salt: string | null = config.ipSalt;
  const getSalt = async (): Promise<string> => {
    if (salt === null) salt = await store.secret(`salt:${utcDay(now)}`, SALT_TTL_SECONDS);
    return salt;
  };

  if (config.rateLimit > 0) {
    const windowId = Math.floor(now / 1000 / config.rateWindowSeconds);
    const token = `rate:${await hashIp(ip, await getSalt(), String(windowId))}`;
    const r = await store.rate(token, config.rateWindowSeconds, config.rateLimit);
    if (!r.allowed) {
      return {
        response: errorJson(429, "rate_limited", "rate limit exceeded", {
          headers: { "retry-after": String(r.resetSeconds) },
        }),
        log: logBase,
      };
    }
  }

  const bot = isBot(request.headers.get("user-agent"), config.botPattern);
  if (config.ignoreBots && bot) {
    const rec = await store.read(name);
    return {
      response: json(
        rec ? counterBody(namespace, key, rec) : { namespace, key, count: 0, updated: null },
        { headers: { "x-tally-counted": "false" } },
      ),
      log: { ...logBase, bot: true, counted: false },
    };
  }

  const inc = parseIncrement(url.searchParams.get("by"), config.maxIncrement);
  if (!inc.ok) {
    return {
      response: errorJson(
        400,
        "bad_increment",
        `by must be an integer from 1 to ${config.maxIncrement}`,
      ),
      log: logBase,
    };
  }

  if (config.dedup !== "none") {
    const windowLabel = config.dedup === "ip-day" ? utcDay(now) : utcHour(now);
    const ttl = config.dedup === "ip-day" ? SALT_TTL_SECONDS : 7200;
    const token = `dedup:${name}:${windowLabel}:${await hashIp(ip, await getSalt(), windowLabel)}`;
    if (await store.seen(token, ttl)) {
      const rec = await store.read(name);
      return {
        response: json(
          rec ? counterBody(namespace, key, rec) : { namespace, key, count: 0, updated: null },
          { headers: { "x-tally-counted": "false" } },
        ),
        log: { ...logBase, bot, counted: false },
      };
    }
  }

  const capsOff = config.autoCreate && config.maxCounters === 0 && config.maxNamespaces === 0;
  if (!capsOff) {
    const existing = await store.read(name);
    if (!existing) {
      if (!config.autoCreate) {
        return {
          response: errorJson(
            403,
            "auto_create_disabled",
            "this counter does not exist and auto create is off",
          ),
          log: logBase,
        };
      }
      const counts = await store.counts();
      if (config.maxCounters > 0 && counts.counters >= config.maxCounters) {
        return {
          response: errorJson(403, "limit_reached", "counter limit reached for this instance"),
          log: logBase,
        };
      }
      if (
        config.maxNamespaces > 0 &&
        counts.namespaces >= config.maxNamespaces &&
        !(await store.hasNamespace(namespace))
      ) {
        return {
          response: errorJson(403, "limit_reached", "namespace limit reached for this instance"),
          log: logBase,
        };
      }
    }
  }

  const result = await store.increment(name, inc.value, now);
  return {
    response: json(counterBody(namespace, key, result), {
      headers: { "x-tally-counted": "true" },
    }),
    log: { ...logBase, bot, counted: true },
  };
}

async function badgeRoute(
  url: URL,
  store: Store,
  config: Config,
  namespace: string,
  key: string,
): Promise<RouteResult> {
  const q = url.searchParams;
  const label = q.get("label") ?? "views";
  const color = q.get("color") ?? undefined;
  const labelColor = q.get("labelColor") ?? q.get("labelcolor") ?? undefined;
  const style = (q.get("style") ?? "flat") as BadgeStyle;
  const abbrev = q.get("abbrev") === "1" || q.get("abbrev") === "true";

  let valueText = "n/a";
  let statusNote = "ok";

  const check = validateName(namespace, key, config);
  if (!check.ok) {
    statusNote = `400 ${check.code}`;
    valueText = "invalid";
  } else {
    try {
      const rec = await store.read(check.name);
      const count = rec?.value ?? 0n;
      valueText = abbrev ? abbreviate(count) : count.toString();
    } catch {
      statusNote = "503 storage_unavailable";
      valueText = "error";
    }
  }

  const svg = renderBadge({ label, value: valueText, color, labelColor, style });
  const etag = `W/"${fnv1a(svg)}"`;

  const headers: Record<string, string> = {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": `public, max-age=${config.badgeCacheSeconds}`,
    "x-tally-status": statusNote,
    "etag": etag,
  };

  return {
    response: new Response(svg, { status: 200, headers }),
    log: { route: "badge", namespace, key },
  };
}

// ----------------------------------------------------------------------------
// admin routes
// ----------------------------------------------------------------------------

async function adminRoute(
  request: Request,
  url: URL,
  method: string,
  verb: string,
  segments: string[],
  store: Store,
  config: Config,
  now: number,
): Promise<RouteResult> {
  if (config.adminToken === null) return { response: notFound(), log: { route: `admin:${verb}` } };

  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer || !(await secretsMatch(bearer, config.adminToken))) {
    return {
      response: errorJson(401, "unauthorized", "missing or invalid admin token"),
      log: { route: `admin:${verb}` },
    };
  }

  const wantMethod: Record<string, string> = {
    stats: "GET",
    export: "GET",
    import: "POST",
    set: "POST",
    reset: "POST",
    delete: "DELETE",
  };
  if (method !== wantMethod[verb]) {
    return { response: methodNotAllowed(wantMethod[verb]), log: { route: `admin:${verb}` } };
  }

  if (verb === "stats") {
    return { response: await adminStats(store, config), log: { route: "admin:stats" } };
  }
  if (verb === "export") {
    return { response: await adminExport(store, config), log: { route: "admin:export" } };
  }
  if (verb === "import") {
    return {
      response: await adminImport(request, url, store, config, now),
      log: { route: "admin:import" },
    };
  }

  // set | reset | delete take a target
  const target = parseTarget(verb, segments);
  if (!target) return { response: notFound(), log: { route: `admin:${verb}` } };
  const decoded = decodeSegments(target.namespace, target.key);
  if (!decoded) {
    return {
      response: errorJson(400, "bad_key", "namespace or key is not valid url text"),
      log: { route: `admin:${verb}` },
    };
  }
  const check = validateName(decoded.namespace, decoded.key, config);
  if (!check.ok) {
    return {
      response: errorJson(400, check.code, `${check.field} does not match the allowed pattern`),
      log: { route: `admin:${verb}` },
    };
  }

  if (verb === "delete") {
    await store.remove(check.name);
    return {
      response: json({ namespace: decoded.namespace, key: decoded.key, deleted: true }),
      log: { route: "admin:delete", namespace: decoded.namespace, key: decoded.key },
    };
  }

  if (verb === "reset") {
    const rec = await store.write(check.name, 0n, now);
    return {
      response: json(counterBody(decoded.namespace, decoded.key, rec)),
      log: { route: "admin:reset", namespace: decoded.namespace, key: decoded.key },
    };
  }

  // set
  const body = await readJsonBody(request, config);
  if (!body.ok) return { response: body.response, log: { route: "admin:set" } };
  const raw = (body.value as { count?: unknown }).count;
  const value = toCount(raw);
  if (value === null) {
    return {
      response: errorJson(400, "bad_body", "count must be a non negative integer"),
      log: { route: "admin:set" },
    };
  }
  const rec = await store.write(check.name, value, now);
  return {
    response: json(counterBody(decoded.namespace, decoded.key, rec)),
    log: { route: "admin:set", namespace: decoded.namespace, key: decoded.key },
  };
}

async function adminStats(store: Store, config: Config): Promise<Response> {
  const s = await store.stats();
  const rows: { namespace: string; key: string; count: number | string }[] = [];
  for await (const rec of store.list()) {
    const { namespace, key } = splitName(rec.name);
    rows.push({
      namespace,
      key,
      count: rec.value <= 9_007_199_254_740_991n ? Number(rec.value) : rec.value.toString(),
    });
  }
  rows.sort((a, b) => Number(BigInt(b.count) - BigInt(a.count)));
  return json({
    version: config.version,
    counters: s.counters,
    namespaces: s.namespaces,
    totalHits: s.totalHits <= 9_007_199_254_740_991n ? Number(s.totalHits) : s.totalHits.toString(),
    top: rows.slice(0, 10),
  });
}

async function adminExport(store: Store, config: Config): Promise<Response> {
  const counters: Record<string, unknown>[] = [];
  for await (const rec of store.list()) {
    const { namespace, key } = splitName(rec.name);
    counters.push({
      namespace,
      key,
      count: rec.value.toString(),
      createdAt: new Date(rec.createdAt).toISOString(),
      updatedAt: new Date(rec.updatedAt).toISOString(),
    });
  }
  return json({ version: config.version, exportedAt: new Date().toISOString(), counters });
}

async function adminImport(
  request: Request,
  url: URL,
  store: Store,
  config: Config,
  now: number,
): Promise<Response> {
  const mode = url.searchParams.get("mode") === "replace" ? "replace" : "merge";
  const body = await readJsonBody(request, config);
  if (!body.ok) return body.response;
  const list = (body.value as { counters?: unknown }).counters;
  if (!Array.isArray(list)) {
    return errorJson(400, "bad_body", "body must be { counters: [ ... ] }");
  }
  if (list.length > 10_000) {
    return errorJson(400, "bad_body", "import is limited to 10000 counters per call");
  }
  let imported = 0;
  let skipped = 0;
  for (const item of list) {
    const row = item as { namespace?: unknown; key?: unknown; count?: unknown };
    if (typeof row.namespace !== "string" || typeof row.key !== "string") {
      skipped++;
      continue;
    }
    const check = validateName(row.namespace, row.key, config);
    const value = toCount(row.count);
    if (!check.ok || value === null) {
      skipped++;
      continue;
    }
    if (mode === "replace") await store.write(check.name, value, now);
    else await store.increment(check.name, value === 0n ? 0n : value, now);
    imported++;
  }
  return json({ mode, imported, skipped });
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function parseTarget(verb: string, segments: string[]): { namespace: string; key: string } | null {
  // segments[0] is the verb. Expect verb / namespace / key(.svg)
  if (segments.length < 3) return null;
  const namespace = segments[1];
  let key = segments.slice(2).join("/");
  if (verb === "badge" && key.endsWith(".svg")) key = key.slice(0, -4);
  if (!namespace || !key) return null;
  return { namespace, key };
}

function decodeSegments(ns: string, key: string): { namespace: string; key: string } | null {
  try {
    return { namespace: decodeURIComponent(ns), key: decodeURIComponent(key) };
  } catch {
    return null;
  }
}

function toCount(raw: unknown): bigint | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return BigInt(raw);
  if (typeof raw === "string" && /^[0-9]+$/.test(raw)) return BigInt(raw);
  return null;
}

async function readJsonBody(
  request: Request,
  config: Config,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (config.maxBodyBytes > 0 && declared > config.maxBodyBytes) {
    return {
      ok: false,
      response: errorJson(413, "payload_too_large", "request body is too large"),
    };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: errorJson(400, "bad_body", "could not read request body") };
  }
  if (config.maxBodyBytes > 0 && text.length > config.maxBodyBytes) {
    return {
      ok: false,
      response: errorJson(413, "payload_too_large", "request body is too large"),
    };
  }
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorJson(400, "bad_body", "request body is not valid json") };
  }
}

function notFound(): Response {
  return errorJson(404, "not_found", "no such route");
}

function methodNotAllowed(allow: string): Response {
  return errorJson(405, "method_not_allowed", `allowed methods: ${allow}`, {
    headers: { "allow": allow },
  });
}

function makeLogger(config: Config, ctx: HandlerContext): (e: LogEntry) => void {
  const order: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = order[config.logLevel];
  const sink = ctx.log ?? ((e: LogEntry) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...e });
    if (e.level === "error") console.error(line);
    else if (e.level === "warn") console.warn(line);
    else console.log(line);
  });
  return (e: LogEntry) => {
    if (order[e.level] < min) return;
    if (e.level === "info" && config.logSample < 1 && Math.random() >= config.logSample) return;
    sink(e);
  };
}
