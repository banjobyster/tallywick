# tallywick

![vibe coded](https://img.shields.io/badge/vibe%20coded-AI%20assisted-8957e5)

A self hosted hit counter. One small service you deploy to your own free account
on Deno Deploy or Cloudflare Workers. It keeps running totals and hands them back
as JSON or as an SVG badge.

> This project was built with an AI coding assistant (Claude), from the design
> through the tests and this documentation. Read the code on that basis before
> depending on it. The storage conformance suite and the Cloudflare integration
> tests run against real engines, not mocks, so behaviour is verified rather
> than assumed.

It is not analytics. There are no sessions, referrers, funnels, or dashboards.
For that, run GoatCounter, Plausible, or Umami. tallywick answers one question,
how many times a thing happened, and it does that without a database server,
without cookies, and without storing a raw IP address.

Every user runs their own copy, so an instance only ever serves its owner's
traffic and no shared service can be overrun or shut down under you.

## Contents

- [Why](#why)
- [Deploy](#deploy)
- [Use it on a page](#use-it-on-a-page)
- [API](#api)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Free tier limits](#free-tier-limits)
- [Project layout](#project-layout)
- [Development](#development)
- [License](#license)

## Why

A static site cannot count anything. It serves files and runs no code. GitHub
Insights counts visits to the repository page, not to the published site, and
GitHub Pages has no page analytics at all.

The free counter services that let anyone create a key tend to disappear. They
carry the abuse load and the cost for one operator, and the free storage limits
break the moment one key gets popular. CountAPI worked that way and shut down.

tallywick is small enough to self host in a few minutes. Because each user
deploys their own instance, uptime is theirs and the limits are never shared.

## Deploy

Pick one platform. Both run the same core code and cost nothing within the free
tier.

### Deno Deploy

Runs `adapters/deno/main.ts` and needs a Deno KV database.

1. Fork this repository.
2. At [console.deno.com](https://console.deno.com), create an app from the fork
   with entry point `adapters/deno/main.ts`.
3. Provision a Deno KV database in the organization view and assign it to the
   app.
4. Set `ALLOWED_ORIGINS` to your site origin. Set `ADMIN_TOKEN` if you want the
   admin routes.
5. Deploy.

Full steps and local development are in [docs/deploy-deno.md](docs/deploy-deno.md).

### Cloudflare Workers

Runs a Worker that forwards to a SQLite Durable Object. `wrangler.jsonc` already
declares the binding and the migration.

```bash
cd adapters/cloudflare
npm install
npx wrangler login
npx wrangler secret put ADMIN_TOKEN   # optional
npx wrangler deploy
```

Full steps are in [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md).

### Verify

```bash
curl https://YOUR-DEPLOYMENT/v1/hit/example/home
curl https://YOUR-DEPLOYMENT/v1/hit/example/home   # count goes up
curl https://YOUR-DEPLOYMENT/v1/get/example/home   # count unchanged
```

## Use it on a page

### Browser client

`client/tallywick.js` has no dependencies and never throws. On any failure it
resolves to `null`, so the host page is never blocked or broken.

```js
import { mountTallywick } from "./tallywick.js";

const BASE = "https://YOUR-DEPLOYMENT";

// Increments once on load, then fills #views only when the count is above zero.
mountTallywick("#views", BASE, "my-site", "home");
```

Lower level call:

```js
import { tallywick } from "./tallywick.js";

const count = await tallywick(BASE, "my-site", "home");                 // hit and read
const current = await tallywick(BASE, "my-site", "home", { mode: "get" });
```

### React

```jsx
import { useTallywick } from "./react.js";

function ViewCount() {
  const { count } = useTallywick(BASE, "my-site", "home");
  if (!count) return null;
  return <span>{count.toLocaleString()} views</span>;
}
```

### Badge, no JavaScript

The badge route returns an SVG and never increments, so it is safe in a README.

```markdown
![views](https://YOUR-DEPLOYMENT/v1/badge/my-site/home.svg?label=views&abbrev=1)
```

More options are in [client/examples/img-badge.md](client/examples/img-badge.md).

## API

Base path is `/v1`. Full reference in [docs/api.md](docs/api.md).

| Method | Route | Auth | Writes | Purpose |
|---|---|---|---|---|
| GET, POST | `/v1/hit/:namespace/:key` | none | yes | Increment by 1 or `?by=N`, return the new count |
| GET | `/v1/get/:namespace/:key` | none | no | Return the count, zero when absent, never creates |
| GET | `/v1/badge/:namespace/:key.svg` | none | no | SVG badge for the current count |
| GET | `/healthz` | none | no | Liveness and backend name |
| GET | `/v1/stats` | admin | no | Totals and the ten highest counters |
| GET | `/v1/export` | admin | no | Full JSON dump |
| POST | `/v1/import` | admin | yes | Load a dump, `?mode=merge` or `replace` |
| POST | `/v1/set/:namespace/:key` | admin | yes | Set an exact value |
| POST | `/v1/reset/:namespace/:key` | admin | yes | Set to zero |
| DELETE | `/v1/delete/:namespace/:key` | admin | yes | Delete a counter |

Response shape:

```json
{ "namespace": "my-site", "key": "home", "count": 128, "updated": "2026-09-02T18:20:00.000Z" }
```

A count above 2^53 is returned as a string, with a `countString` field
alongside.

## Configuration

Every setting is an environment variable with a working default. A bad value
stops the service at start rather than failing per request. Full reference in
[docs/configuration.md](docs/configuration.md).

| Variable | Default | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | `*` | Browser origins allowed to read counts. Set this. |
| `AUTO_CREATE` | `true` | Allow a `hit` to create a counter |
| `NAMESPACE_ALLOWLIST` | empty | Restrict namespaces to a fixed list |
| `KEY_PATTERN` | `^[A-Za-z0-9._-]{1,64}$` | Allowed shape of a namespace and key |
| `MAX_NAMESPACES` | `50` | Cap on namespaces, `0` for unlimited |
| `MAX_COUNTERS` | `5000` | Cap on counters, `0` for unlimited |
| `MAX_INCREMENT` | `100` | Largest `?by=N` |
| `DEDUP` | `none` | `none`, `ip-hour`, or `ip-day` |
| `REQUIRE_POST` | `false` | Reject `GET` on the hit route |
| `RATE_LIMIT` | `60` | Write requests per IP per window, `0` to disable |
| `RATE_WINDOW_SECONDS` | `60` | Rate window length |
| `IGNORE_BOTS` | `false` | Do not count requests with a bot `User-Agent` |
| `IP_SALT` | empty | Pin the IP hash salt, otherwise it rotates daily |
| `ADMIN_TOKEN` | empty | Bearer token for admin routes, empty hides them |
| `READONLY` | `false` | Reject all writes with 503 |
| `BADGE_CACHE_SECONDS` | `300` | `max-age` on badge responses |
| `CORS_MAX_AGE` | `86400` | `Access-Control-Max-Age` on preflight |
| `MAX_BODY_BYTES` | `16384` | Reject larger request bodies |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_SAMPLE` | `1` | Fraction of info request logs to emit |
| `CF_SHARD_BY_NAMESPACE` | `false` | Cloudflare only, one Durable Object per namespace |

## How it works

The core is one platform neutral request handler. It talks to a `Store` and
returns a web `Response`. Adapters supply the entrypoint and the `Store`.

| Platform | Backend | Consistency |
|---|---|---|
| Deno Deploy | Deno KV, atomic `sum` on a `Deno.KvU64` | Linearizable per key |
| Cloudflare | Durable Object with SQLite storage | One request at a time per object |

Cloudflare Workers KV is not used. It caps writes at 1,000 per day on the free
plan and is eventually consistent, so counts would drift. The Durable Object is
single threaded and transactional, so parallel hits never lose a count.

Privacy defaults hold on both. No cookies. The raw IP is hashed with a daily
rotating salt for deduplication and rate limiting, then discarded, and is never
written or logged.

Design detail is in [docs/architecture.md](docs/architecture.md) and
[docs/privacy.md](docs/privacy.md). The full design record is in
[SPEC.md](SPEC.md).

## Free tier limits

Figures below were current when this was written. Confirm them on the vendor
pricing pages.

| | Deno Deploy | Cloudflare Workers |
|---|---|---|
| Requests | about 1,000,000 per month | 100,000 per day |
| Counter writes | about 500,000 KV write units per month | 100,000 Durable Object row writes per day |
| Storage | 1 GiB KV | 5 GiB SQLite |

One `hit` is one write, or two in a dedup mode. A personal site stays far inside
either allowance.

## Project layout

```
core/                platform neutral handler, config, badge, validation
  handler.ts         routing and all request logic
  types.ts           the Store interface
  memory_store.ts    in memory Store for tests and local use
adapters/
  deno/              Deno.serve entrypoint and a Deno KV Store
  cloudflare/        Worker, SQLite Durable Object, wrangler config, vitest
client/
  tallywick.js       browser client, no dependencies
  react.js           useTallywick hook
  examples/          vanilla, React, and img badge
test/                handler tests and the shared storage conformance suite
docs/                api, configuration, deployment, privacy, architecture
```

## Development

The core and the Deno adapter use the Deno toolchain, with no install step.

```bash
deno task test        # core tests plus conformance against MemoryStore, Deno KV, and SQLite
deno task lint
deno task fmt
deno task dev         # run the Deno adapter on http://localhost:8000
```

The Cloudflare adapter uses npm.

```bash
cd adapters/cloudflare
npm install
npm test              # Worker and Durable Object under workerd
npm run typecheck
npm run dry-run       # validate wrangler.jsonc and bundle the Worker
```

### Continuous integration

The pipeline is defined in [docs/ci-workflow.yml](docs/ci-workflow.yml). Move it
to `.github/workflows/ci.yml` to activate it. That path is created through the
GitHub web editor, or through a push from a token that carries the `workflow`
scope.

## License

MIT. See [LICENSE](LICENSE).
