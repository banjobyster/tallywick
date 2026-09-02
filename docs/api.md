# HTTP API

Base path is `/v1`. The same routes without the prefix are accepted and behave
identically. They are not the documented form.

Every JSON response carries `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`. Cross origin responses carry
`Access-Control-Allow-Origin` only when the request `Origin` matches
`ALLOWED_ORIGINS`.

## Conventions

A counter is addressed by two path segments, `namespace` and `key`. Both must
match `KEY_PATTERN`, which defaults to `^[A-Za-z0-9._-]{1,64}$`. The stored name
is `namespace + "/" + key`. Names are case sensitive.

Counts are unsigned integers. A count at or below 2^53 is a JSON number. A
larger count is a JSON string, and the response also carries `countString`.

## Public routes

### `GET /`

Service description.

```json
{
  "name": "tallywick",
  "version": "0.1.0",
  "docs": "https://github.com/banjobyster/tallywick",
  "routes": {
    "hit": "GET|POST /v1/hit/:namespace/:key",
    "get": "GET /v1/get/:namespace/:key",
    "badge": "GET /v1/badge/:namespace/:key.svg"
  }
}
```

### `GET /healthz`

Liveness and backend name.

```json
{ "ok": true, "version": "0.1.0", "storage": "deno-kv" }
```

### `GET|POST /v1/hit/:namespace/:key`

Increment the counter, then return it. Creates the counter at the increment
amount when it does not exist and `AUTO_CREATE` is on.

Query parameters:

| Name | Default | Notes |
|---|---|---|
| `by` | `1` | Integer from 1 to `MAX_INCREMENT`. Out of range gives 400 `bad_increment`. |

Response headers:

| Header | Values | Meaning |
|---|---|---|
| `X-Tally-Counted` | `true`, `false` | Whether this request moved the counter. `false` when a dedup window or bot rule suppressed it. |

```
GET /v1/hit/portfolio/home
200
{ "namespace": "portfolio", "key": "home", "count": 129, "updated": "2026-09-02T18:20:00.000Z" }
```

`GET` is accepted so a plain `<img>` or a script without a body can record a
view. Set `REQUIRE_POST` to reject `GET`.

### `GET /v1/get/:namespace/:key`

Return the counter without changing it. Returns zero for a counter that does not
exist and never creates one.

```
GET /v1/get/portfolio/home
200
{ "namespace": "portfolio", "key": "home", "count": 129, "updated": "2026-09-02T18:20:00.000Z" }
```

For an unknown counter, `updated` is `null`.

### `GET /v1/badge/:namespace/:key.svg`

An SVG badge for the current count. Read only. The `.svg` suffix is optional.

Query parameters:

| Name | Default | Notes |
|---|---|---|
| `label` | `views` | Left text |
| `color` | `#4c1` | Right colour, a hex value or a Shields colour name |
| `labelColor` | `#555` | Left colour |
| `style` | `flat` | `flat`, `flat-square`, `plastic`, `for-the-badge` |
| `abbrev` | off | `abbrev=1` renders `1234` as `1.2k` |

Response headers:

| Header | Notes |
|---|---|
| `Content-Type` | `image/svg+xml; charset=utf-8` |
| `Cache-Control` | `public, max-age=<BADGE_CACHE_SECONDS>` |
| `ETag` | Weak tag over the SVG body |
| `X-Tally-Status` | `ok`, or the reason a fallback badge was rendered |

The badge route always returns HTTP 200 with a valid SVG. A validation or
storage problem renders a fallback badge and reports the cause in
`X-Tally-Status`, so an embedded image never breaks a page.

## Admin routes

Admin routes require `Authorization: Bearer <ADMIN_TOKEN>`. When `ADMIN_TOKEN`
is unset, every admin route returns 404 so the surface is not visible.

### `GET /v1/stats`

```json
{
  "version": "0.1.0",
  "counters": 12,
  "namespaces": 3,
  "totalHits": 84213,
  "top": [{ "namespace": "portfolio", "key": "home", "count": 41000 }]
}
```

`top` holds the ten highest counters.

### `GET /v1/export`

Full dump. Counts are strings so precision is never lost.

```json
{
  "version": "0.1.0",
  "exportedAt": "2026-09-02T18:20:00.000Z",
  "counters": [
    { "namespace": "portfolio", "key": "home", "count": "41000", "createdAt": "...", "updatedAt": "..." }
  ]
}
```

### `POST /v1/import`

Body is `{ "counters": [ { "namespace", "key", "count" } ] }`, at most 10000
entries per call.

| Query | Default | Effect |
|---|---|---|
| `mode` | `merge` | `merge` adds `count` to the existing value. `replace` overwrites it. |

```json
{ "mode": "merge", "imported": 9, "skipped": 1 }
```

Entries with an invalid name or count are skipped, not rejected.

### `POST /v1/set/:namespace/:key`

Body is `{ "count": <non negative integer> }`. Sets an exact value and returns
the counter.

### `POST /v1/reset/:namespace/:key`

Sets the counter to zero and returns it.

### `DELETE /v1/delete/:namespace/:key`

```json
{ "namespace": "portfolio", "key": "home", "deleted": true }
```

## Status codes

| Code | `code` | When |
|---|---|---|
| 200 | | Success |
| 400 | `bad_namespace`, `bad_key`, `bad_increment`, `bad_body` | Invalid input |
| 400 | `namespace_not_allowed` | Namespace is not in `NAMESPACE_ALLOWLIST` |
| 401 | `unauthorized` | Missing or wrong admin token |
| 403 | `auto_create_disabled` | Unknown counter and `AUTO_CREATE` is off |
| 403 | `limit_reached` | `MAX_COUNTERS` or `MAX_NAMESPACES` reached |
| 404 | `not_found` | Unknown route, or an admin route with `ADMIN_TOKEN` unset |
| 405 | `method_not_allowed` | Wrong method for the route. Carries `Allow`. |
| 413 | `payload_too_large` | Body over `MAX_BODY_BYTES` |
| 429 | `rate_limited` | Over the rate limit. Carries `Retry-After`. |
| 503 | `readonly` | Write attempted while `READONLY` is on |
| 503 | `storage_unavailable` | Backend error |
| 500 | `internal` | Unexpected error |

## Preflight

`OPTIONS` on any route returns 204 with `Access-Control-Allow-Methods`,
`Access-Control-Allow-Headers: Authorization, Content-Type`, and
`Access-Control-Max-Age` from `CORS_MAX_AGE`.
