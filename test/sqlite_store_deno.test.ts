/**
 * Run the shared storage conformance suite against SqliteStore.
 *
 * The Durable Object provides a synchronous `SqlStorage`. Here that surface is
 * emulated with `node:sqlite`, which uses the same SQL engine, so the store's
 * queries are exercised for real. Each case gets a fresh in memory database.
 *
 *   deno test --allow-read --allow-write --allow-ffi --allow-env \
 *     test/sqlite_store_deno.test.ts
 */

import { DatabaseSync } from "node:sqlite";
import { conformanceCases } from "./conformance.ts";
import { SqliteStore, type SqlLike } from "../adapters/cloudflare/src/sqlite_store.ts";

class NodeSqlite implements SqlLike {
  #db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.#db = db;
  }
  exec(query: string, ...bindings: (string | number | null)[]) {
    const stmt = this.#db.prepare(query);
    if (/^\s*(SELECT|WITH)/i.test(query)) {
      return {
        toArray: () =>
          stmt.all(...bindings) as Record<string, string | number | null | ArrayBuffer>[],
      };
    }
    stmt.run(...bindings);
    return { toArray: () => [] };
  }
}

for (const c of conformanceCases()) {
  Deno.test(`conformance: SqliteStore: ${c.name}`, async () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteStore(new NodeSqlite(db));
    store.migrate();
    try {
      await c.run(store);
    } finally {
      db.close();
    }
  });
}
