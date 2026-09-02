/**
 * Run the shared storage conformance suite against DenoKvStore, backed by an
 * in memory Deno KV. Each case gets a fresh database.
 *
 *   deno test --allow-env --unstable-kv adapters/deno/kv_store.test.ts
 */

import { conformanceCases } from "../../test/conformance.ts";
import { DenoKvStore } from "./kv_store.ts";

for (const c of conformanceCases()) {
  Deno.test(`conformance: DenoKvStore: ${c.name}`, async () => {
    const kv = await Deno.openKv(":memory:");
    const store = new DenoKvStore(kv);
    try {
      await c.run(store);
    } finally {
      kv.close();
    }
  });
}
