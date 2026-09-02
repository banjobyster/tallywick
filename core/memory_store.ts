/**
 * In memory Store.
 *
 * Backs the test suite, local development, and the examples. State is lost when
 * the process ends. Not for production.
 */

import type { CounterRecord, IncrementResult, RateResult, Store, StoreStats } from "./types.ts";
import { splitName } from "./validate.ts";

interface Ephemeral {
  expiresAt: number;
}

interface RateRow {
  count: number;
  windowEnd: number;
}

/** A Store that keeps everything in maps. */
export class MemoryStore implements Store {
  #counters = new Map<string, CounterRecord>();
  #seen = new Map<string, Ephemeral>();
  #rate = new Map<string, RateRow>();
  #secrets = new Map<string, { value: string; expiresAt: number }>();

  read(name: string): Promise<CounterRecord | null> {
    const rec = this.#counters.get(name);
    return Promise.resolve(rec ? { ...rec } : null);
  }

  hasNamespace(namespace: string): Promise<boolean> {
    const prefix = `${namespace}/`;
    for (const key of this.#counters.keys()) {
      if (key.startsWith(prefix)) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  increment(name: string, delta: bigint, now: number): Promise<IncrementResult> {
    const existing = this.#counters.get(name);
    if (existing) {
      existing.value += delta;
      existing.updatedAt = now;
      return Promise.resolve({ ...existing, created: false });
    }
    const rec: CounterRecord = { name, value: delta, createdAt: now, updatedAt: now };
    this.#counters.set(name, rec);
    return Promise.resolve({ ...rec, created: true });
  }

  write(name: string, value: bigint, now: number): Promise<CounterRecord> {
    const existing = this.#counters.get(name);
    const rec: CounterRecord = existing
      ? { ...existing, value, updatedAt: now }
      : { name, value, createdAt: now, updatedAt: now };
    this.#counters.set(name, rec);
    return Promise.resolve({ ...rec });
  }

  remove(name: string): Promise<void> {
    this.#counters.delete(name);
    return Promise.resolve();
  }

  async *list(): AsyncIterable<CounterRecord> {
    for (const rec of this.#counters.values()) yield { ...rec };
  }

  counts(): Promise<{ counters: number; namespaces: number }> {
    const namespaces = new Set<string>();
    for (const rec of this.#counters.values()) namespaces.add(splitName(rec.name).namespace);
    return Promise.resolve({ counters: this.#counters.size, namespaces: namespaces.size });
  }

  stats(): Promise<StoreStats> {
    const namespaces = new Set<string>();
    let total = 0n;
    for (const rec of this.#counters.values()) {
      namespaces.add(splitName(rec.name).namespace);
      total += rec.value;
    }
    return Promise.resolve({
      counters: this.#counters.size,
      namespaces: namespaces.size,
      totalHits: total,
    });
  }

  seen(token: string, ttlSeconds: number): Promise<boolean> {
    const row = this.#seen.get(token);
    const now = Date.now();
    if (row && row.expiresAt > now) return Promise.resolve(true);
    this.#seen.set(token, { expiresAt: now + ttlSeconds * 1000 });
    return Promise.resolve(false);
  }

  rate(token: string, windowSeconds: number, max: number): Promise<RateResult> {
    const now = Date.now();
    let row = this.#rate.get(token);
    if (!row || row.windowEnd <= now) {
      row = { count: 0, windowEnd: now + windowSeconds * 1000 };
      this.#rate.set(token, row);
    }
    row.count++;
    const resetSeconds = Math.max(0, Math.ceil((row.windowEnd - now) / 1000));
    return Promise.resolve({
      allowed: row.count <= max,
      remaining: Math.max(0, max - row.count),
      resetSeconds,
    });
  }

  secret(name: string, ttlSeconds: number): Promise<string> {
    const now = Date.now();
    const row = this.#secrets.get(name);
    if (row && row.expiresAt > now) return Promise.resolve(row.value);
    const value = randomHex(16);
    this.#secrets.set(name, { value, expiresAt: now + ttlSeconds * 1000 });
    return Promise.resolve(value);
  }

  sweep(now: number): Promise<void> {
    for (const [k, v] of this.#seen) if (v.expiresAt <= now) this.#seen.delete(k);
    for (const [k, v] of this.#rate) if (v.windowEnd <= now) this.#rate.delete(k);
    for (const [k, v] of this.#secrets) if (v.expiresAt <= now) this.#secrets.delete(k);
    return Promise.resolve();
  }

  /** Test helper. Wipe all state. */
  clear(): void {
    this.#counters.clear();
    this.#seen.clear();
    this.#rate.clear();
    this.#secrets.clear();
  }
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}
