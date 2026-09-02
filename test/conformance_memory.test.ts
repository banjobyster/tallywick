/**
 * Run the storage conformance suite against MemoryStore under `deno test`.
 * The Cloudflare adapter runs the same cases against its SQLite store with
 * vitest, see adapters/cloudflare/test.
 */

import { MemoryStore } from "../core/memory_store.ts";
import { conformanceCases } from "./conformance.ts";

for (const c of conformanceCases()) {
  Deno.test(`conformance: MemoryStore: ${c.name}`, async () => {
    await c.run(new MemoryStore());
  });
}
