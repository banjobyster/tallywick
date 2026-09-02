/**
 * Deno KV backed Store.
 *
 * Layout:
 *   ["c", name]      Deno.KvU64        counter value, summed atomically
 *   ["m", name]      { createdAt, updatedAt }
 *   ["ns", ns]       true              namespace marker
 *   ["meta"]         { counters, namespaces }
 *   ["seen", token]  1                 dedup marker, expiring
 *   ["rate", w, tok] Deno.KvU64        fixed window request count, expiring
 *   ["secret", name] string            rotating salt, expiring
 *
 * Counter increments on an existing counter go through `sum` with no version
 * check, so parallel hits never contend and never lose a count. Counter
 * creation and deletion use an optimistic check with retry so the meta counts
 * stay exact.
 */

import type {
  CounterRecord,
  IncrementResult,
  RateResult,
  Store,
  StoreStats,
} from "../../core/types.ts";
import { splitName } from "../../core/validate.ts";

interface Meta {
  createdAt: number;
  updatedAt: number;
}
interface Counts {
  counters: number;
  namespaces: number;
}

const RETRIES = 16;

export class DenoKvStore implements Store {
  #kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  /** Open the platform database, or a path for local use. */
  static async open(path?: string): Promise<DenoKvStore> {
    return new DenoKvStore(await Deno.openKv(path));
  }

  async read(name: string): Promise<CounterRecord | null> {
    const [val, meta] = await this.#kv.getMany<[Deno.KvU64, Meta]>([["c", name], ["m", name]]);
    if (val.value === null) return null;
    const m = meta.value ?? { createdAt: 0, updatedAt: 0 };
    return { name, value: val.value.value, createdAt: m.createdAt, updatedAt: m.updatedAt };
  }

  async hasNamespace(namespace: string): Promise<boolean> {
    const entry = await this.#kv.get(["ns", namespace]);
    return entry.value !== null;
  }

  async increment(name: string, delta: bigint, now: number): Promise<IncrementResult> {
    const ns = splitName(name).namespace;

    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const [val, meta] = await this.#kv.getMany<[Deno.KvU64, Meta]>([["c", name], ["m", name]]);
      const created = meta.value === null;

      if (!created) {
        // Fast path. `sum` is commutative, so no check and no contention.
        const res = await this.#kv.atomic()
          .mutate({ type: "sum", key: ["c", name], value: new Deno.KvU64(delta) })
          .set(["m", name], { createdAt: meta.value!.createdAt, updatedAt: now })
          .commit();
        if (res.ok) {
          return {
            name,
            value: (val.value?.value ?? 0n) + delta,
            createdAt: meta.value!.createdAt,
            updatedAt: now,
            created: false,
          };
        }
        continue;
      }

      // Creation. Guard the meta and counts so they stay exact.
      const [nsEntry, countsEntry] = await this.#kv.getMany<[true, Counts]>([
        ["ns", ns],
        ["meta"],
      ]);
      const nsNew = nsEntry.value === null;
      const counts = countsEntry.value ?? { counters: 0, namespaces: 0 };

      const op = this.#kv.atomic()
        .check(val)
        .check(meta)
        .check(countsEntry)
        .mutate({ type: "sum", key: ["c", name], value: new Deno.KvU64(delta) })
        .set(["m", name], { createdAt: now, updatedAt: now })
        .set(["meta"], {
          counters: counts.counters + 1,
          namespaces: counts.namespaces + (nsNew ? 1 : 0),
        });
      if (nsNew) op.check(nsEntry).set(["ns", ns], true);

      const res = await op.commit();
      if (res.ok) {
        return { name, value: delta, createdAt: now, updatedAt: now, created: true };
      }
    }
    throw new Error("kv contention: increment did not converge");
  }

  async write(name: string, value: bigint, now: number): Promise<CounterRecord> {
    const ns = splitName(name).namespace;

    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const [val, meta] = await this.#kv.getMany<[Deno.KvU64, Meta]>([["c", name], ["m", name]]);
      const created = meta.value === null;
      const createdAt = created ? now : meta.value!.createdAt;

      const op = this.#kv.atomic()
        .check(val)
        .check(meta)
        .set(["c", name], new Deno.KvU64(value < 0n ? 0n : value))
        .set(["m", name], { createdAt, updatedAt: now });

      if (created) {
        const [nsEntry, countsEntry] = await this.#kv.getMany<[true, Counts]>([["ns", ns], [
          "meta",
        ]]);
        const nsNew = nsEntry.value === null;
        const counts = countsEntry.value ?? { counters: 0, namespaces: 0 };
        op.check(countsEntry).set(["meta"], {
          counters: counts.counters + 1,
          namespaces: counts.namespaces + (nsNew ? 1 : 0),
        });
        if (nsNew) op.check(nsEntry).set(["ns", ns], true);
      }

      const res = await op.commit();
      if (res.ok) return { name, value: value < 0n ? 0n : value, createdAt, updatedAt: now };
    }
    throw new Error("kv contention: write did not converge");
  }

  async remove(name: string): Promise<void> {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const [val, meta, countsEntry] = await this.#kv.getMany<[Deno.KvU64, Meta, Counts]>([
        ["c", name],
        ["m", name],
        ["meta"],
      ]);
      if (val.value === null && meta.value === null) return;

      const counts = countsEntry.value ?? { counters: 0, namespaces: 0 };
      const op = this.#kv.atomic()
        .check(val)
        .check(meta)
        .check(countsEntry)
        .delete(["c", name])
        .delete(["m", name])
        .set(["meta"], {
          counters: Math.max(0, counts.counters - 1),
          namespaces: counts.namespaces,
        });

      const res = await op.commit();
      if (res.ok) return;
    }
    throw new Error("kv contention: remove did not converge");
  }

  async *list(): AsyncIterable<CounterRecord> {
    for await (const entry of this.#kv.list<Deno.KvU64>({ prefix: ["c"] })) {
      const name = String(entry.key[1]);
      const meta = await this.#kv.get<Meta>(["m", name]);
      const m = meta.value ?? { createdAt: 0, updatedAt: 0 };
      yield { name, value: entry.value.value, createdAt: m.createdAt, updatedAt: m.updatedAt };
    }
  }

  async counts(): Promise<Counts> {
    const entry = await this.#kv.get<Counts>(["meta"]);
    return entry.value ?? { counters: 0, namespaces: 0 };
  }

  async stats(): Promise<StoreStats> {
    const base = await this.counts();
    let total = 0n;
    for await (const entry of this.#kv.list<Deno.KvU64>({ prefix: ["c"] })) {
      total += entry.value.value;
    }
    return { counters: base.counters, namespaces: base.namespaces, totalHits: total };
  }

  async seen(token: string, ttlSeconds: number): Promise<boolean> {
    const key = ["seen", token];
    const entry = await this.#kv.get(key);
    if (entry.value !== null) return true;
    const res = await this.#kv.atomic()
      .check(entry)
      .set(key, 1, { expireIn: ttlSeconds * 1000 })
      .commit();
    return !res.ok;
  }

  async rate(token: string, windowSeconds: number, max: number): Promise<RateResult> {
    const key = ["rate", token];
    const ttlMs = (windowSeconds + 60) * 1000;

    for (let attempt = 0; attempt < 5; attempt++) {
      const now = Date.now();
      const entry = await this.#kv.get<{ count: number; windowEnd: number }>(key);
      const row = entry.value && entry.value.windowEnd > now
        ? { count: entry.value.count + 1, windowEnd: entry.value.windowEnd }
        : { count: 1, windowEnd: now + windowSeconds * 1000 };
      const res = await this.#kv.atomic()
        .check(entry)
        .set(key, row, { expireIn: ttlMs })
        .commit();
      if (res.ok) {
        return {
          allowed: row.count <= max,
          remaining: Math.max(0, max - row.count),
          resetSeconds: Math.max(1, Math.ceil((row.windowEnd - now) / 1000)),
        };
      }
    }
    // Contention on the rate key. Fail open rather than block a real user.
    return { allowed: true, remaining: max, resetSeconds: windowSeconds };
  }

  async secret(name: string, ttlSeconds: number): Promise<string> {
    const key = ["secret", name];
    const entry = await this.#kv.get<string>(key);
    if (entry.value !== null) return entry.value;
    const value = randomHex(16);
    const res = await this.#kv.atomic()
      .check(entry)
      .set(key, value, { expireIn: ttlSeconds * 1000 })
      .commit();
    if (res.ok) return value;
    const again = await this.#kv.get<string>(key);
    return again.value ?? value;
  }

  sweep(_now: number): Promise<void> {
    // Every ephemeral key carries expireIn, so the backend removes its own.
    return Promise.resolve();
  }

  close(): void {
    this.#kv.close();
  }
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}
