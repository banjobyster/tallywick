# tallywick design record

This is the pre build design record. The project shipped as **tallywick**. It
was drafted under the working name `tally`, which still appears below as
shorthand. For current usage read [README.md](README.md) and the files in
[docs/](docs/), which supersede this document wherever they differ.

It defines scope, behavior, the HTTP API, configuration, the storage
abstraction, and the deployment path for both Deno Deploy and Cloudflare
Workers.

## 1. Summary

`tally` is a small web service that keeps running totals. A page calls it once
per view, the count goes up by one, and the new value comes back as JSON or as
an SVG badge. It stores each counter as a single integer. It is deployed by the
person who uses it, on their own free account, so each instance serves only its
owner's traffic.

It is not an analytics product and not a hosted multi tenant service. Those two
boundaries are what keep it dependable and cheap.

## 2. Problem

GitHub Pages and other static hosts cannot count anything. They serve files and
run no code. GitHub Insights counts visits to the repository page, not to the
published site, so it does not answer the question "how many people opened my
page".

Free counter services that anyone can create keys on tend to die. They carry
abuse load and cost for the operator, and the free storage limits break when one
key gets popular. CountAPI worked this way and shut down.

The fix is a service small enough to self host in minutes, where every user runs
their own copy and owns their own uptime.

## 3. Goals

- One file worth of configuration to deploy. No build step required on Deno.
- Runs on Deno Deploy and on Cloudflare Workers from the same core code.
- Exact counts under concurrency on both platforms.
- A JSON API and an SVG badge from the same counter.
- A tiny browser client that never breaks the host page.
- Sensible privacy defaults. No cookies. No raw IP stored or logged.
- Configurable dedup, rate limiting, CORS, and abuse caps.
- Zero runtime dependencies.

## 4. Non goals

- No page analytics. No referrers, sessions, funnels, geographies, or
  dashboards beyond a minimal totals view. Point users at GoatCounter, Plausible,
  or Umami for that.
- No hosted service that strangers can create counters on. Self host only.
- No user accounts, billing, or teams.
- No historical time series in v1. An optional daily breakdown is a v2 item.
- No consent management. The operator owns the legal responsibility.

## 5. Users and use cases

- A developer with a static portfolio who wants a visible view count in the
  footer.
- A library author who wants a "used by" or "views" badge in a README.
- A small site that wants a like button or a downloads counter.
- Anyone who wants a page hit total without adding a tracking script.

## 6. Platform targets and constraints

Values below were current at the time of writing. Confirm them on the vendor
pricing pages before build, since both vendors revise limits.

### Deno Deploy, free plan

| Item | Limit |
|---|---|
| Requests | 1,000,000 per month |
| Egress | about 20 GiB per month |
| Deno KV storage | 1 GiB |
| Deno KV reads | 1,000,000 read units per month |
| Deno KV writes | 500,000 write units per month |
| CPU | 10 hours active CPU per month |
| Active apps | 10 |
| Over limit | treat as a hard cap |

Deno KV must be provisioned in the dashboard and assigned to the app. After that
`Deno.openKv()` with no argument connects automatically. Deno KV supports atomic
`sum`, `min`, `max`, and `check` on a `Deno.KvU64` value, and per key expiry
through `expireIn`. Key size limit is about 2 KiB. Value size limit is about
64 KiB. The old dashboard at `dash.deno.com` was retired in July 2026. The
current console is `console.deno.com`.

Meaning for a counter. 500,000 write units per month is roughly 16,000 hits per
day pooled across every counter on the instance, with exact atomic increments.
That is comfortable for a personal site and a small project. Dedup mode adds one
short lived write per counted unique visitor.

### Cloudflare Workers, free plan

| Item | Limit |
|---|---|
| Worker requests | 100,000 per day |
| CPU | about 10 ms per invocation |
| Workers KV reads | 100,000 per day |
| Workers KV writes | 1,000 per day |
| Workers KV storage | 1 GiB |
| Durable Objects compute requests | 100,000 per day |
| Durable Objects SQLite rows read | 5,000,000 per day |
| Durable Objects SQLite rows written | 100,000 per day |
| Durable Objects SQLite storage | 5 GiB |
| Durable Objects duration | 13,000 GB seconds per day |
| Over limit | further operations of that type fail |

Meaning for a counter. Workers KV allows only 1,000 writes per day and is
eventually consistent with propagation up to about 60 seconds, and concurrent
writes to one key can be lost. It is not suitable for counting. The Durable
Object SQLite backend is single threaded per object, transactional, and allows
100,000 row writes per day. It is the correct Cloudflare backend for this
service. Only SQLite backed Durable Objects are available on the free plan.

### Consequence for the design

The storage layer maps to a different primitive on each platform.

| Platform | Backend | Consistency |
|---|---|---|
| Deno Deploy | Deno KV, `Deno.KvU64` with atomic `sum` | linearizable per key |
| Cloudflare | Durable Object with SQLite storage | serialized per object |
| Cloudflare, discouraged | Workers KV | eventual, lossy, off by default |

## 7. Architecture

Three parts.

**Core.** Platform agnostic. A single request handler that takes a `Request` and
a `Store` and returns a `Response`. Also the config parser, the key validator,
the client IP hasher, the bot matcher, and the SVG badge renderer. No platform
APIs. Fully unit testable with a fake store.

**Adapters.** One per platform. Each provides an entrypoint and a `Store`
implementation.

- Deno adapter. `Deno.serve` entrypoint. `Store` backed by `Deno.openKv()`.
- Cloudflare adapter. A `fetch` handler that forwards to one Durable Object. The
  Durable Object holds the SQLite `Store`.

**Client.** A framework free browser function, a React hook, and copy paste
snippets. Published behavior is identical against any deployed instance.

```
tally/
  core/
    handler.ts        request handler, routing, response shaping
    store.ts          Store interface and shared types
    config.ts         env parsing and defaults
    validate.ts       namespace and key validation
    ip.ts             client IP extraction and hashing
    bots.ts           bot user agent pattern
    badge.ts          SVG badge renderer
  adapters/
    deno/
      main.ts
      store-kv.ts
      deno.json
    cloudflare/
      src/worker.ts
      src/counter-do.ts
      wrangler.toml
  client/
    tally.js
    react.ts
    examples/
  test/
    handler_test.ts
    conformance_test.ts
    badge_test.ts
  docs/
    api.md
    config.md
    deploy-deno.md
    deploy-cloudflare.md
    privacy.md
  README.md
  LICENSE
  CHANGELOG.md
```

## 8. Storage abstraction

```ts
export interface Store {
  // Current value, no mutation. Returns 0n if the counter does not exist.
  read(name: string): Promise<bigint>;

  // Atomically add delta (delta >= 1n). Creates the counter at delta if absent.
  // Returns the new value.
  increment(name: string, delta: bigint): Promise<bigint>;

  // Admin. Set an exact value, creating the counter if needed.
  write(name: string, value: bigint): Promise<void>;

  // Admin. Remove a counter. No error if it is already gone.
  remove(name: string): Promise<void>;

  // Iterate counters whose name starts with prefix, for stats and export.
  list(prefix: string): AsyncIterable<{ name: string; value: bigint }>;

  // Short lived flag. Returns true if the token was already present.
  // Otherwise records it with the given ttl and returns false.
  // Used for dedup.
  seen(token: string, ttlSeconds: number): Promise<boolean>;

  // Fixed window request count for one token. Returns whether the caller is
  // under max for the current window and how many remain.
  // Used for rate limiting.
  rate(
    token: string,
    windowSeconds: number,
    max: number,
  ): Promise<{ allowed: boolean; remaining: number; resetSeconds: number }>;

  // Housekeeping. Delete expired dedup and rate rows. May be a no op where the
  // backend expires rows on its own.
  sweep(): Promise<void>;
}
```

### Deno KV mapping

| Purpose | Key | Value |
|---|---|---|
| Counter | `["c", namespace, key]` | `Deno.KvU64` |
| Dedup | `["d", windowId, namespace, key, ipHash]` | `1`, `expireIn` set |
| Rate | `["r", windowId, ipHash]` | `Deno.KvU64`, `expireIn` set |
| Meta | `["meta", "counters"]` | `Deno.KvU64`, number of counters |
| Salt | `["salt", day]` | random bytes, `expireIn` two days |

`increment` uses `kv.atomic().sum(key, delta).commit()` with a retry on commit
failure. `read` uses `kv.get`. `seen` uses an atomic `check` for absence then
`set` with `expireIn`. Deno KV expires rows on its own so `sweep` is a no op.

### Cloudflare Durable Object mapping

One Durable Object per deployment, addressed by `idFromName("root")`. All
counters live in its SQLite database. Sharding by namespace is possible by
addressing `idFromName(namespace)` and is documented for operators who outgrow
one object.

```sql
CREATE TABLE IF NOT EXISTS counters (
  name       TEXT PRIMARY KEY,
  value      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dedup (
  token      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate (
  token      TEXT PRIMARY KEY,
  count      INTEGER NOT NULL,
  window_end INTEGER NOT NULL
);
```

`increment` is an `INSERT ... ON CONFLICT ... DO UPDATE SET value = value + ?`
returning the new value, inside the object's single thread, so no lock is
needed. `seen` inserts the token and treats a primary key conflict as "already
seen". `rate` reads the row, compares `window_end`, and updates. A Durable
Object alarm runs `sweep` hourly to delete expired `dedup` and `rate` rows.

### Counter name

The public API uses `namespace` and `key` as two path segments. The store name
is `namespace + "/" + key` after validation. Names are case sensitive.

## 9. HTTP API

Base path is `/v1`. The same routes without the prefix are accepted as aliases
and are documented as non canonical. All JSON responses carry
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

### Response envelope

Success.

```json
{
  "namespace": "portfolio",
  "key": "home",
  "count": 128,
  "updated": "2026-09-02T18:20:00Z"
}
```

Error.

```json
{ "error": "rate limit exceeded", "code": "rate_limited" }
```

### Routes

| Method | Path | Auth | Writes | Purpose |
|---|---|---|---|---|
| GET | `/` | none | no | Service name, version, docs link |
| GET | `/healthz` | none | no | `{ "ok": true, "version": "...", "storage": "deno-kv" }` |
| GET | `/v1/get/:namespace/:key` | none | no | Return the count. 0 if the counter does not exist. Never creates. |
| GET, POST | `/v1/hit/:namespace/:key` | none | yes | Increment by 1, or by `?by=N`. Return the new count. |
| GET | `/v1/badge/:namespace/:key.svg` | none | no | SVG badge for the current count. Read only. |
| GET | `/v1/stats` | admin | no | Totals and top counters |
| GET | `/v1/export` | admin | no | Full JSON dump of all counters |
| POST | `/v1/import` | admin | yes | Load a dump. `?mode=merge` default, or `replace` |
| POST | `/v1/set/:namespace/:key` | admin | yes | Body `{ "count": N }`. Set exact value |
| POST | `/v1/reset/:namespace/:key` | admin | yes | Set to 0 |
| DELETE | `/v1/delete/:namespace/:key` | admin | yes | Remove the counter |

### Query parameters

| Route | Param | Default | Notes |
|---|---|---|---|
| `hit` | `by` | `1` | Integer from 1 to `MAX_INCREMENT`. Out of range is 400. |
| `badge` | `label` | `views` | Left text |
| `badge` | `color` | `#4c1` | Named color or hex for the value side |
| `badge` | `labelColor` | `#555` | Hex for the label side |
| `badge` | `style` | `flat` | `flat`, `flat-square`, `plastic`, `for-the-badge` |
| `badge` | `abbrev` | `0` | `1` renders `1234` as `1.2k` |
| `import` | `mode` | `merge` | `merge` adds values, `replace` overwrites |

### Status codes

| Code | Meaning |
|---|---|
| 200 | Success |
| 400 | Invalid namespace, key, or parameter |
| 401 | Missing or invalid admin token |
| 403 | Origin not allowed, auto create disabled, or a cap was reached |
| 404 | Unknown route, or admin route while `ADMIN_TOKEN` is unset |
| 405 | Method not allowed on the route |
| 413 | Request body over `MAX_BODY_BYTES` |
| 429 | Rate limit exceeded. Carries `Retry-After` |
| 503 | Read only mode, or storage temporarily unavailable |
| 500 | Unexpected error |

The badge route always returns HTTP 200 with a valid SVG. When something is
wrong it renders the problem as the value text and reports the real cause in the
`X-Tally-Status` header and the logs, so an embedded image never breaks a page
layout.

### Examples

```
GET /v1/hit/portfolio/home
200  { "namespace": "portfolio", "key": "home", "count": 129, "updated": "..." }

GET /v1/get/portfolio/home
200  { "namespace": "portfolio", "key": "home", "count": 129, "updated": "..." }

GET /v1/badge/portfolio/home.svg?label=visitors&abbrev=1
200  image/svg+xml

POST /v1/reset/portfolio/home       Authorization: Bearer <ADMIN_TOKEN>
200  { "namespace": "portfolio", "key": "home", "count": 0, "updated": "..." }
```

## 10. Configuration reference

All configuration is environment variables. Every value has a working default so
a bare deploy runs.

| Variable | Default | Meaning |
|---|---|---|
| `ALLOWED_ORIGINS` | `*` | Comma list. Exact origins and `*.example.com` wildcards. Controls the `Access-Control-Allow-Origin` reply. |
| `AUTO_CREATE` | `true` | When false, `hit` on an unknown counter returns 403 and only admin `set` creates counters. |
| `NAMESPACE_ALLOWLIST` | empty | Comma list of allowed namespace names. Empty means any name that passes `KEY_PATTERN`. |
| `KEY_PATTERN` | `^[A-Za-z0-9._-]{1,64}$` | Regex applied to both `namespace` and `key`. |
| `MAX_NAMESPACES` | `50` | Cap on distinct namespaces per instance. |
| `MAX_COUNTERS` | `5000` | Cap on distinct counters per instance. |
| `MAX_INCREMENT` | `100` | Upper bound for `?by=N`. |
| `DEDUP` | `none` | `none`, `ip-hour`, or `ip-day`. Suppresses repeat counts from the same hashed IP inside the window. |
| `REQUIRE_POST` | `false` | When true, `hit` rejects GET and needs POST. Reduces counts from prefetchers and scanners. |
| `RATE_LIMIT` | `60` | Write requests allowed per hashed IP per window. `0` disables. |
| `RATE_WINDOW_SECONDS` | `60` | Rate limit window length. |
| `IGNORE_BOTS` | `false` | When true, requests with a bot user agent are not counted. The current value is still returned. |
| `BOT_PATTERN` | built in | Override regex for bot detection. |
| `IP_SALT` | empty | Pin the salt used to hash client IPs. Empty means a random per day salt held in storage. |
| `ADMIN_TOKEN` | empty | Bearer token for admin routes. Empty disables admin routes and they return 404. |
| `READONLY` | `false` | When true, all write routes return 503. For incident response. |
| `BADGE_CACHE_SECONDS` | `300` | `max-age` on badge responses. |
| `CORS_MAX_AGE` | `86400` | `Access-Control-Max-Age` on preflight. |
| `MAX_BODY_BYTES` | `16384` | Reject larger request bodies with 413. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `LOG_SAMPLE` | `1.0` | Fraction of request logs to emit. |

v2 candidates, not implemented in v1.

| Variable | Default | Meaning |
|---|---|---|
| `DAILY_BREAKDOWN` | `false` | Also keep per day counts. |
| `BREAKDOWN_RETENTION_DAYS` | `90` | Retention for per day counts. |
| `SESSION_DEDUP` | `false` | Cookie based dedup as an alternative to IP based. |

## 11. Behaviors

### Counting

A `hit` increments by 1, or by `by` when supplied and in range. The counter is
created at that value if it does not exist and `AUTO_CREATE` is true. The
response carries the value after the increment. `updated` is the server time of
the write in ISO 8601 UTC.

Counts are `bigint` internally. They serialize as a JSON number while under
2 to the 53. Above that they serialize as a string and the response adds
`"countString": "..."`. Deno KV stores a `u64`. The Durable Object stores a
SQLite integer, which is 64 bit signed. Document both ceilings.

### GET that writes

`GET /v1/hit/...` is not idempotent. Link prefetchers, chat unfurlers, and
crawlers can trigger it. Four controls reduce this. `DEDUP`, `RATE_LIMIT`,
`IGNORE_BOTS`, and `REQUIRE_POST`. GET is allowed by default because it is what
lets a plain `<img>` or a no script page record a view. The badge route never
writes, so a README that embeds the badge does not inflate the count.

### Deduplication

`DEDUP` set to `ip-hour` or `ip-day` computes a token from the hashed client IP,
the namespace, the key, and the window id. If `seen(token)` is true the request
is not counted and the current value is returned with header
`X-Tally-Counted: false`. If false the counter increments and the token is
stored with a ttl one window long. `none` counts every request.

### Rate limiting

For write routes and admin routes the service calls `rate(ipHash, window, max)`
before touching a counter. Over the limit returns 429 with `Retry-After` set to
the seconds until the window resets and body code `rate_limited`. Read routes and
the badge route are exempt. `RATE_LIMIT` of 0 disables the check.

### CORS

For every request with an `Origin` header, if the origin matches
`ALLOWED_ORIGINS` the response sets `Access-Control-Allow-Origin` to that origin
and adds `Vary: Origin`. If it does not match the header is omitted and the
browser blocks the read. `OPTIONS` preflight is answered with
`Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: Authorization,
Content-Type`, and `Access-Control-Max-Age` from `CORS_MAX_AGE`. Credentialed
mode is never enabled. The badge route sends `Access-Control-Allow-Origin: *`
since it is an image.

### Privacy and client IP

The raw client IP is never written to storage and never logged. When dedup or
rate limiting needs an identity the service computes
`sha256(ip + "|" + salt + "|" + windowId)` and keeps the first 16 bytes as hex.
The salt rotates every UTC day unless `IP_SALT` pins it. The client IP is read
from the platform's trusted source. On Deno Deploy that is the
`x-forwarded-for` left most entry as set by the platform. On Cloudflare that is
`request.headers.get("cf-connecting-ip")`. Application supplied forwarding
headers are ignored. No cookies are set in any v1 mode. Responses on write and
read routes carry `Cache-Control: no-store`. A hashed IP with a rotating daily
salt is widely treated as acceptable for visit counting. Legal responsibility
sits with the operator, and `docs/privacy.md` states this.

### Abuse controls

`namespace` and `key` are validated against `KEY_PATTERN`. `NAMESPACE_ALLOWLIST`
restricts namespace names when set. On counter creation the service checks a
maintained counter count against `MAX_COUNTERS` and the namespace count against
`MAX_NAMESPACES`, and returns 403 with code `limit_reached` when exceeded.
`AUTO_CREATE` false together with a set `ADMIN_TOKEN` produces a locked instance
where only the operator defines counters.

### Bot filtering

With `IGNORE_BOTS` true, a request whose user agent matches `BOT_PATTERN` does
not increment. The current value is still returned, with `X-Tally-Counted:
false`. The default pattern covers common crawlers and link preview bots. It is
cheap and imperfect.

### Badge rendering

`badge.ts` is a pure function that returns SVG text. No external service and no
network call. Text width is computed from a fixed character width table for the
common Latin set, the same technique Shields uses, so the badge renders without
embedded fonts. Supported `style` values are `flat`, `flat-square`, `plastic`,
and `for-the-badge`. `abbrev=1` formats large numbers as `1.2k` and `3.4M`.
Headers are `Content-Type: image/svg+xml; charset=utf-8`,
`Cache-Control: public, max-age=BADGE_CACHE_SECONDS`, and a content `ETag`.
GitHub proxies README images through its own cache, so a badge on GitHub updates
slowly. This is documented, not fixed.

### Read only mode

`READONLY` true makes every write route return 503 with code `readonly`. Reads
and badges still work. This is a switch for incident response and for freezing a
counter.

## 12. Consistency and accuracy

- Deno KV `atomic().sum()` on a `Deno.KvU64` is linearizable per key on Deno
  Deploy. Concurrent increments do not lose updates.
- A Cloudflare Durable Object runs one invocation at a time. Every counter in the
  object updates in strict order. SQLite writes are transactional. No lost
  updates.
- Sharding counters across several Durable Objects keeps exactness, since each
  counter lives in exactly one object.
- The discouraged Workers KV backend is eventually consistent, with propagation
  up to about 60 seconds and possible lost writes under concurrency. It is off by
  default and gated behind an explicit `STORAGE=cf-kv` setting with a startup
  warning. Recommended only for a low traffic badge.
- A counter is a running total. It never decreases except through admin `set` or
  `reset`.

## 13. Error handling

- Validation failures return 400 with a specific `code` such as `bad_key`,
  `bad_namespace`, or `bad_increment`, and name the offending field. Input is not
  echoed beyond the field name.
- Missing or wrong admin token returns 401 with code `unauthorized`, except that
  admin routes return 404 when `ADMIN_TOKEN` is unset so the surface is not
  visible.
- Storage errors return 503 with code `storage_unavailable` after one internal
  retry.
- Unknown routes return 404 JSON with code `not_found`.
- The badge route never returns a non 200. It renders an error badge and sets
  `X-Tally-Status`.

## 14. Security

- Compare `ADMIN_TOKEN` in constant time using a fixed length hash comparison.
- Disable admin routes entirely when `ADMIN_TOKEN` is empty.
- Redact `Authorization` in logs. Never log secret values.
- Reject bodies over `MAX_BODY_BYTES` with 413 before parsing.
- Set `X-Content-Type-Options: nosniff` on JSON responses.
- The only long lived secrets are `ADMIN_TOKEN` and the optional `IP_SALT`.
- Rate limiting runs before any storage write.

## 15. Observability

- Structured JSON logs with fields `ts`, `level`, `route`, `status`, `ns`,
  `key`, `counted`, `bot`, `dur_ms`. No IP. No user agent string.
- `GET /healthz` returns `{ "ok": true, "version": "...", "storage": "..." }`.
- Admin `GET /v1/stats` returns
  `{ "counters": N, "namespaces": N, "totalHits": N, "top": [ ... ], "since": "..." }`.
- `LOG_SAMPLE` controls the fraction of request logs emitted.

## 16. Testing

- The core handler is pure and is tested against an in memory fake `Store`.
  Cover every route, every status code, both dedup modes, the rate limit window
  edges, CORS match and mismatch, key validation, admin auth on and off,
  read only mode, and `by` bounds.
- Badge output is covered with snapshot tests for each `style` and for `abbrev`.
- A conformance suite runs against every real `Store` implementation and asserts
  atomic increment under concurrency, dedup ttl expiry, rate window reset,
  `list`, and `remove`.
- The Deno adapter is tested with `Deno.openKv(":memory:")`.
- The Cloudflare adapter is tested with the Workers test pool and a real SQLite
  Durable Object.
- A load smoke script fires N concurrent hits at a deployed instance and asserts
  the final count equals N.
- CI runs `deno test`, `deno lint`, `deno fmt --check`, the Cloudflare test
  project, and a dry run build of both adapters.

## 17. Deployment

### Deno Deploy

1. Use the template repository.
2. In `console.deno.com` create an app from the repository with entrypoint
   `adapters/deno/main.ts`.
3. In the organization dashboard provision a Deno KV database and assign it to
   the app.
4. Set environment variables on the app. At minimum set `ALLOWED_ORIGINS`, and
   `ADMIN_TOKEN` if admin routes are wanted.
5. Deploy. Verify with two calls to `https://APP.deno.dev/v1/hit/site/home` and
   one call to `/v1/get/site/home`.

### Cloudflare Workers

1. Use the template repository.
2. Install `wrangler` and run `wrangler login`.
3. `wrangler.toml` already declares the Durable Object binding and a
   `new_sqlite_classes` migration. Set `[vars]` for configuration and run
   `wrangler secret put ADMIN_TOKEN` for the token.
4. Run `wrangler deploy`.
5. Verify the same way as above.
6. A one click path is `https://deploy.workers.cloudflare.com/?url=<repo>`.

### Deploy buttons

The README carries a "Deploy to Deno" link and a "Deploy to Cloudflare" button,
each pointed at the template repository.

## 18. Client library

`client/tally.js`, framework free, no dependencies.

```ts
tally(baseUrl, namespace, key, options?) => Promise<number | null>
// options: { mode: "hit" | "get" = "hit", by = 1, timeoutMs = 3000, signal }
// Never throws. Resolves null on any failure. Uses fetch with cache "no-store".

mountTally(selector, baseUrl, namespace, key, options?) => Promise<void>
// options adds { format?: (n: number) => string }. Writes text into the node
// only when the count is greater than 0.
```

`client/react.ts`.

```ts
useTally(baseUrl, namespace, key, options?) => { count: number | null, loading: boolean, error: unknown }
// Fires once on mount. count is null until loaded. Render nothing when null or 0.
```

The docs also show the zero script path, an `<img>` tag pointed at the badge
route.

## 19. Performance targets

- Added latency for `hit` under 15 ms at p50 on both platforms, excluding
  network.
- Cold start under 50 ms on Deno and under 10 ms on Cloudflare.
- One storage write and at most two reads per `hit` in `none` dedup mode. Dedup
  modes add one read and one write.

## 20. Versioning

- Semantic versioning. The HTTP API lives under `/v1`. A breaking change moves to
  `/v2` and `/v1` stays for at least one minor line.
- The Cloudflare adapter pins `compatibility_date`. The Deno adapter records a
  tested Deno version.
- Zero runtime dependencies is a release requirement. Development dependencies are
  limited to test and lint tooling.

## 21. Prior art

- CountAPI. Free, no signup, shut down. The model this project avoids.
- Abacus. Free, no signup, hobby maintained.
- hits.sh. Badge only hit counter.
- GoatCounter, Plausible, Umami. Full analytics. Heavier, and a different job.

`tally` is a self hosted running total with a badge and a tiny client. It is not
analytics.

## 22. Open decisions

These are settled before implementation.

1. Name and repository. `tally` is a common name on GitHub. Pick the final name
   and whether the repo is public.
2. `ALLOWED_ORIGINS` default. Permissive `*` for zero configuration, or deny by
   default and force the operator to set it.
3. `AUTO_CREATE` default. On for zero configuration, or off for a locked
   instance.
4. `REQUIRE_POST` default. Keep GET allowed for `<img>` and no script use, or
   require POST for cleaner counts.
5. Ship the Workers KV backend at all, or drop it and support only the Durable
   Object on Cloudflare.
6. Daily breakdown in v1, or deferred to v2 as written here.
7. License. MIT is assumed.
8. Publish the client to npm, or keep it copy paste only.
9. Build order. Full package now, or ship the minimal personal counter first and
   grow it under the same repo.

## 23. Definition of done for v1

- Both adapters deploy from a clean clone by following the docs with no code
  edits.
- The conformance suite passes on both backends.
- `hit`, `get`, `badge`, all admin routes, `DEDUP` none and `ip-day`, rate
  limiting, the CORS allowlist, and read only mode are implemented and tested.
- The README has a quickstart per platform, the full configuration table, and
  the privacy note.
- The portfolio site and the bysters site both run against one deployed
  instance.

## 24. Milestones

- M1. Core handler, `Store` interface, fake store, full handler test suite.
- M2. Deno adapter and deploy. Wire the portfolio and bysters footers.
- M3. Cloudflare adapter and deploy. Conformance parity with Deno.
- M4. Badge renderer, client library, docs.
- M5. Examples, CHANGELOG, license, deploy buttons, publish.
