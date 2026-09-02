/**
 * Storage conformance suite.
 *
 * Every {@link Store} implementation must pass these. The cases are runner
 * agnostic. A wrapper registers them with `Deno.test` or with vitest `it`.
 *
 * `makeStore` returns a fresh, empty store for each case.
 */

import type { Store } from "../core/types.ts";
import { assert, assertEquals } from "./assert.ts";

export interface ConformanceCase {
  name: string;
  run: (store: Store) => Promise<void>;
}

const T0 = 1_759_000_000_000; // fixed epoch ms for deterministic timestamps

export function conformanceCases(): ConformanceCase[] {
  return [
    {
      name: "read returns null for an unknown counter",
      run: async (store) => {
        assertEquals(await store.read("site/home"), null);
      },
    },
    {
      name: "increment creates then adds",
      run: async (store) => {
        const a = await store.increment("site/home", 1n, T0);
        assertEquals(a.value, 1n);
        assertEquals(a.created, true);
        const b = await store.increment("site/home", 5n, T0 + 1000);
        assertEquals(b.value, 6n);
        assertEquals(b.created, false);
        const rec = await store.read("site/home");
        assertEquals(rec?.value, 6n);
        assertEquals(rec?.createdAt, T0);
        assertEquals(rec?.updatedAt, T0 + 1000);
      },
    },
    {
      name: "parallel increments do not lose updates",
      run: async (store) => {
        const N = 200;
        await Promise.all(
          Array.from({ length: N }, () => store.increment("race/key", 1n, T0)),
        );
        const rec = await store.read("race/key");
        assertEquals(rec?.value, BigInt(N));
      },
    },
    {
      name: "write sets an exact value",
      run: async (store) => {
        await store.increment("site/home", 10n, T0);
        const rec = await store.write("site/home", 3n, T0 + 5000);
        assertEquals(rec.value, 3n);
        assertEquals((await store.read("site/home"))?.value, 3n);
      },
    },
    {
      name: "write creates when absent",
      run: async (store) => {
        const rec = await store.write("fresh/one", 42n, T0);
        assertEquals(rec.value, 42n);
      },
    },
    {
      name: "remove deletes and is idempotent",
      run: async (store) => {
        await store.increment("gone/key", 1n, T0);
        await store.remove("gone/key");
        assertEquals(await store.read("gone/key"), null);
        await store.remove("gone/key");
      },
    },
    {
      name: "hasNamespace reflects counter presence",
      run: async (store) => {
        assertEquals(await store.hasNamespace("blog"), false);
        await store.increment("blog/post-1", 1n, T0);
        assertEquals(await store.hasNamespace("blog"), true);
        assertEquals(await store.hasNamespace("blogg"), false);
      },
    },
    {
      name: "list yields every counter once",
      run: async (store) => {
        await store.increment("a/one", 1n, T0);
        await store.increment("a/two", 2n, T0);
        await store.increment("b/one", 3n, T0);
        const seen = new Map<string, bigint>();
        for await (const rec of store.list()) seen.set(rec.name, rec.value);
        assertEquals(seen.size, 3);
        assertEquals(seen.get("a/two"), 2n);
        assertEquals(seen.get("b/one"), 3n);
      },
    },
    {
      name: "counts tracks counters and namespaces",
      run: async (store) => {
        assertEquals(await store.counts(), { counters: 0, namespaces: 0 });
        await store.increment("a/one", 1n, T0);
        await store.increment("a/two", 1n, T0);
        await store.increment("b/one", 1n, T0);
        assertEquals(await store.counts(), { counters: 3, namespaces: 2 });
        await store.remove("a/one");
        assertEquals(await store.counts(), { counters: 2, namespaces: 2 });
      },
    },
    {
      name: "stats aggregates counters, namespaces, and total",
      run: async (store) => {
        await store.increment("a/one", 4n, T0);
        await store.increment("a/two", 6n, T0);
        await store.increment("b/one", 10n, T0);
        const s = await store.stats();
        assertEquals(s.counters, 3);
        assertEquals(s.namespaces, 2);
        assertEquals(s.totalHits, 20n);
      },
    },
    {
      name: "seen is false the first time and true after",
      run: async (store) => {
        assertEquals(await store.seen("tok-1", 60), false);
        assertEquals(await store.seen("tok-1", 60), true);
        assertEquals(await store.seen("tok-2", 60), false);
      },
    },
    {
      name: "rate allows up to max then blocks",
      run: async (store) => {
        const r1 = await store.rate("ip-x", 60, 3);
        assert(r1.allowed);
        assertEquals(r1.remaining, 2);
        await store.rate("ip-x", 60, 3);
        const r3 = await store.rate("ip-x", 60, 3);
        assert(r3.allowed);
        assertEquals(r3.remaining, 0);
        const r4 = await store.rate("ip-x", 60, 3);
        assert(!r4.allowed);
        assert(r4.resetSeconds > 0 && r4.resetSeconds <= 60);
      },
    },
    {
      name: "secret is stable for the same name",
      run: async (store) => {
        const a = await store.secret("salt:2026-09-02", 3600);
        const b = await store.secret("salt:2026-09-02", 3600);
        assertEquals(a, b);
        assert(a.length >= 16);
        const c = await store.secret("salt:2026-09-03", 3600);
        assert(c !== a);
      },
    },
    {
      name: "large values survive past 2^53",
      run: async (store) => {
        const big = 9_007_199_254_740_993n;
        await store.write("big/one", big, T0);
        assertEquals((await store.read("big/one"))?.value, big);
        const inc = await store.increment("big/one", 2n, T0 + 1);
        assertEquals(inc.value, big + 2n);
      },
    },
    {
      name: "sweep runs without error",
      run: async (store) => {
        await store.seen("old", 1);
        await store.rate("old", 1, 1);
        await store.sweep(T0 + 10_000_000);
      },
    },
  ];
}
