# Architecture

## Layers

**Core** is platform neutral. It is a single request handler plus the config
parser, validators, the IP hasher, the bot matcher, and the badge renderer. It
imports no runtime API. It talks to a `Store` and returns a web `Response`.

**Adapters** are one per platform. Each provides an entrypoint and a `Store`.

**Client** is a browser function, a React hook, and copy paste snippets.

```
                    ┌─────────────────────────────┐
  request  ───────▶ │  adapter entrypoint         │
                    │  (Deno.serve or CF Worker)  │
                    └──────────────┬──────────────┘
                                   │ handle(request, store, config, ctx)
                    ┌──────────────▼──────────────┐
                    │  core/handler.ts            │
                    │  routing, dedup, rate limit,│
                    │  CORS, badge, admin auth    │
                    └──────────────┬──────────────┘
                                   │ Store interface
                    ┌──────────────▼──────────────┐
                    │  DenoKvStore  |  SqliteStore │
                    │  MemoryStore (tests, local) │
                    └─────────────────────────────┘
```

## The Store interface

`core/types.ts` defines it. Counter operations must be exact under concurrency.
Ephemeral operations may be approximate under a race, since their only effect is
deduplication, throttling, and salt reuse.

| Method | Purpose |
|---|---|
| `read` | One counter, or null |
| `increment` | Add a delta, create when absent, return the new value and whether it created |
| `write` | Set an exact value |
| `remove` | Delete a counter |
| `hasNamespace` | Whether any counter exists in a namespace, for the cap check |
| `list` | Every counter, for export and stats |
| `counts` | Fast counter and namespace totals, for the cap check on the hit path |
| `stats` | Full aggregate including the sum of all values, for the stats route |
| `seen` | Atomic check and set with a time to live, for deduplication |
| `rate` | Fixed window request count for one token |
| `secret` | Stable random string with a time to live, for the rotating salt |
| `sweep` | Delete expired ephemeral rows, a no op where the backend expires its own |

## Why two different backends

The two target platforms have different primitives, and picking the right one on
each is what keeps counts exact.

| Platform | Backend | Consistency |
|---|---|---|
| Deno Deploy | Deno KV, `sum` on a `Deno.KvU64` | Linearizable per key |
| Cloudflare | Durable Object with SQLite storage | One request at a time per object |

Cloudflare Workers KV is not used. It caps writes at 1,000 per day on the free
plan and is eventually consistent.

## Consistency

- Deno KV `sum` is commutative and atomic, so the hit path issues it with no
  version check and never contends. Counter creation uses an optimistic check
  with retry so the meta counts stay exact.
- A Cloudflare Durable Object processes one request at a time, so a read then
  write inside one method cannot interleave. No lock is needed.
- A counter is a running total. It only goes down through an admin `set` or
  `reset`.

## Testing

- `test/handler.test.ts` covers every route and every config flag against
  `MemoryStore`.
- `test/conformance.ts` is a backend neutral suite. It runs against `MemoryStore`
  and `DenoKvStore` under `deno test`, against `SqliteStore` on a real SQLite
  engine through `node:sqlite`, and the Cloudflare adapter runs its own copy
  against a real SQLite Durable Object under workerd.
- `adapters/cloudflare/test/worker.test.ts` drives the Worker and Durable Object
  end to end with `@cloudflare/vitest-pool-workers`.
