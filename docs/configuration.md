# Configuration

Every setting is an environment variable. Every one has a working default, so a
deployment with no configuration runs. Malformed values stop the service at
start with a `ConfigError` rather than failing per request.

On Deno Deploy, set these in the app settings. On Cloudflare, set plain values
under `vars` in `wrangler.jsonc` and secrets with `wrangler secret put`.

## Access and creation

### `ALLOWED_ORIGINS`

Default `*`. A comma separated list. Controls which browser origins receive an
`Access-Control-Allow-Origin` header on a response. A missing or `*` value
allows any origin and logs a warning at start. Entries are exact origins such as
`https://example.com`, or host suffix wildcards such as `*.example.com`.

Server to server callers such as `curl` and other services are not affected by
this. CORS only governs browser reads.

### `AUTO_CREATE`

Default `true`. When `false`, a `hit` on a counter that does not exist returns
403 `auto_create_disabled`. Only an admin `set` can then create a counter. Use
this with `ADMIN_TOKEN` to run a locked instance where you define every counter.

### `NAMESPACE_ALLOWLIST`

Default empty, meaning any namespace that matches `KEY_PATTERN`. A comma
separated list of permitted namespace names. A `hit` on any other namespace
returns 400 `namespace_not_allowed`.

### `KEY_PATTERN`

Default `^[A-Za-z0-9._-]{1,64}$`. A regular expression applied to both the
`namespace` and the `key` segment. Widen it with care. A permissive pattern lets
callers create arbitrary counters.

### `MAX_NAMESPACES`

Default `50`. `0` means unlimited. A `hit` that would create a counter in a new
namespace past this cap returns 403 `limit_reached`.

### `MAX_COUNTERS`

Default `5000`. `0` means unlimited. A `hit` that would create a counter past
this cap returns 403 `limit_reached`.

When `AUTO_CREATE` is on and both caps are `0`, the hit path skips its existence
check and runs one write with no read.

### `MAX_INCREMENT`

Default `100`. The largest value accepted for the `by` query parameter on a
`hit`.

## Counting behaviour

### `DEDUP`

Default `none`. One of `none`, `ip-hour`, `ip-day`. In a dedup mode, a repeat
`hit` from the same hashed IP for the same counter inside the window is answered
with the current value and `X-Tally-Counted: false`, and the counter does not
move.

### `REQUIRE_POST`

Default `false`. When `true`, a `hit` accepts only `POST`. A `GET` returns 405.
This cuts counts from link prefetchers and scanners at the cost of not working
from a plain `<img>`.

### `RATE_LIMIT`

Default `60`. The number of write requests allowed per hashed IP per window. `0`
disables the check. Over the limit returns 429 with `Retry-After`. Read routes
and the badge route are not rate limited.

### `RATE_WINDOW_SECONDS`

Default `60`. The length of the rate limit window.

### `IGNORE_BOTS`

Default `false`. When `true`, a request whose `User-Agent` matches `BOT_PATTERN`
is answered with the current value and not counted. A request with no
`User-Agent` is treated as a bot in this mode.

### `BOT_PATTERN`

Default is a built in list covering common crawlers and link preview fetchers.
Override with a case insensitive regular expression.

## Privacy

### `IP_SALT`

Default empty. When empty, the service generates a random salt each UTC day and
stores it with a two day expiry, so IP hashes rotate daily. Set a fixed value to
pin the salt, for example if you need hashes to be stable across a longer
window. The raw IP is never stored or logged in either case.

## Admin and safety

### `ADMIN_TOKEN`

Default empty, which disables every admin route. Set a long random value to
enable `stats`, `export`, `import`, `set`, `reset`, and `delete`. The token is
compared in constant time.

### `READONLY`

Default `false`. When `true`, every write route returns 503 `readonly`. Reads
and badges still work. Use it to freeze counters during an incident.

## Output and limits

### `BADGE_CACHE_SECONDS`

Default `300`. The `max-age` on badge responses.

### `CORS_MAX_AGE`

Default `86400`. The `Access-Control-Max-Age` on preflight responses.

### `MAX_BODY_BYTES`

Default `16384`. Request bodies larger than this are rejected with 413.

## Logging

### `LOG_LEVEL`

Default `info`. One of `debug`, `info`, `warn`, `error`.

### `LOG_SAMPLE`

Default `1`. The fraction of `info` request logs to emit, from `0` to `1`.
Warnings and errors are always emitted.

## Cloudflare only

### `CF_SHARD_BY_NAMESPACE`

Default `false`. When `true`, the Worker routes each namespace to its own
Durable Object instead of a single instance. Raises throughput for instances
with many active namespaces at the cost of cross namespace stats and export no
longer being global.
