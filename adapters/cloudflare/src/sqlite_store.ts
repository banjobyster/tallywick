/**
 * SQLite backed Store for a Cloudflare Durable Object.
 *
 * A Durable Object runs one request at a time, so a read then write inside a
 * single method needs no lock and cannot interleave. Counter values are stored
 * as decimal strings and added with BigInt, so precision is exact for any u64
 * and beyond.
 *
 * Tables:
 *   counters(name PK, namespace, value TEXT, created_at, updated_at)
 *   ephemeral(k PK, v TEXT, expires_at)   dedup, rate, and salt rows
 */

import type {
  CounterRecord,
  IncrementResult,
  RateResult,
  Store,
  StoreStats,
} from "../../../core/types.ts";
import { splitName } from "../../../core/validate.ts";

/** The slice of Cloudflare `SqlStorage` this store uses. */
export interface SqlLike {
  exec(query: string, ...bindings: (string | number | null)[]): {
    toArray(): Record<string, string | number | null | ArrayBuffer>[];
  };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS counters (
     name TEXT PRIMARY KEY,
     namespace TEXT NOT NULL,
     value TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS counters_namespace ON counters (namespace)`,
  `CREATE TABLE IF NOT EXISTS ephemeral (
     k TEXT PRIMARY KEY,
     v TEXT NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ephemeral_expiry ON ephemeral (expires_at)`,
];

export class SqliteStore implements Store {
  #sql: SqlLike;

  constructor(sql: SqlLike) {
    this.#sql = sql;
  }

  /** Create tables. Safe to call on every construction. */
  migrate(): void {
    for (const stmt of SCHEMA) this.#sql.exec(stmt);
  }

  read(name: string): Promise<CounterRecord | null> {
    const row = this.#sql
      .exec("SELECT value, created_at, updated_at FROM counters WHERE name = ?", name)
      .toArray()[0];
    if (!row) return Promise.resolve(null);
    return Promise.resolve({
      name,
      value: BigInt(row.value as string),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    });
  }

  hasNamespace(namespace: string): Promise<boolean> {
    const row = this.#sql
      .exec("SELECT 1 AS present FROM counters WHERE namespace = ? LIMIT 1", namespace)
      .toArray()[0];
    return Promise.resolve(!!row);
  }

  increment(name: string, delta: bigint, now: number): Promise<IncrementResult> {
    const ns = splitName(name).namespace;
    const row = this.#sql
      .exec("SELECT value, created_at FROM counters WHERE name = ?", name)
      .toArray()[0];
    if (row) {
      const next = BigInt(row.value as string) + delta;
      this.#sql.exec(
        "UPDATE counters SET value = ?, updated_at = ? WHERE name = ?",
        next.toString(),
        now,
        name,
      );
      return Promise.resolve({
        name,
        value: next,
        createdAt: Number(row.created_at),
        updatedAt: now,
        created: false,
      });
    }
    this.#sql.exec(
      "INSERT INTO counters (name, namespace, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      name,
      ns,
      delta.toString(),
      now,
      now,
    );
    return Promise.resolve({ name, value: delta, createdAt: now, updatedAt: now, created: true });
  }

  write(name: string, value: bigint, now: number): Promise<CounterRecord> {
    const ns = splitName(name).namespace;
    const v = value < 0n ? 0n : value;
    const row = this.#sql
      .exec("SELECT created_at FROM counters WHERE name = ?", name)
      .toArray()[0];
    const createdAt = row ? Number(row.created_at) : now;
    if (row) {
      this.#sql.exec(
        "UPDATE counters SET value = ?, updated_at = ? WHERE name = ?",
        v.toString(),
        now,
        name,
      );
    } else {
      this.#sql.exec(
        "INSERT INTO counters (name, namespace, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        name,
        ns,
        v.toString(),
        now,
        now,
      );
    }
    return Promise.resolve({ name, value: v, createdAt, updatedAt: now });
  }

  remove(name: string): Promise<void> {
    this.#sql.exec("DELETE FROM counters WHERE name = ?", name);
    return Promise.resolve();
  }

  async *list(): AsyncIterable<CounterRecord> {
    const rows = this.#sql
      .exec("SELECT name, value, created_at, updated_at FROM counters ORDER BY name")
      .toArray();
    for (const row of rows) {
      yield {
        name: row.name as string,
        value: BigInt(row.value as string),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
    }
  }

  counts(): Promise<{ counters: number; namespaces: number }> {
    const row = this.#sql
      .exec("SELECT COUNT(*) AS c, COUNT(DISTINCT namespace) AS n FROM counters")
      .toArray()[0];
    return Promise.resolve({ counters: Number(row.c), namespaces: Number(row.n) });
  }

  stats(): Promise<StoreStats> {
    const meta = this.#sql
      .exec("SELECT COUNT(*) AS c, COUNT(DISTINCT namespace) AS n FROM counters")
      .toArray()[0];
    let total = 0n;
    for (const row of this.#sql.exec("SELECT value FROM counters").toArray()) {
      total += BigInt(row.value as string);
    }
    return Promise.resolve({
      counters: Number(meta.c),
      namespaces: Number(meta.n),
      totalHits: total,
    });
  }

  seen(token: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const key = `seen:${token}`;
    const row = this.#sql
      .exec("SELECT 1 AS present FROM ephemeral WHERE k = ? AND expires_at > ?", key, now)
      .toArray()[0];
    if (row) return Promise.resolve(true);
    this.#sql.exec(
      "INSERT OR REPLACE INTO ephemeral (k, v, expires_at) VALUES (?, '1', ?)",
      key,
      now + ttlSeconds * 1000,
    );
    return Promise.resolve(false);
  }

  rate(token: string, windowSeconds: number, max: number): Promise<RateResult> {
    const now = Date.now();
    const key = `rate:${token}`;
    const row = this.#sql
      .exec("SELECT v, expires_at FROM ephemeral WHERE k = ?", key)
      .toArray()[0];
    let count: number;
    let windowEnd: number;
    if (row && Number(row.expires_at) > now) {
      count = Number(row.v) + 1;
      windowEnd = Number(row.expires_at);
    } else {
      count = 1;
      windowEnd = now + windowSeconds * 1000;
    }
    this.#sql.exec(
      "INSERT OR REPLACE INTO ephemeral (k, v, expires_at) VALUES (?, ?, ?)",
      key,
      String(count),
      windowEnd,
    );
    return Promise.resolve({
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetSeconds: Math.max(1, Math.ceil((windowEnd - now) / 1000)),
    });
  }

  secret(name: string, ttlSeconds: number): Promise<string> {
    const now = Date.now();
    const key = `secret:${name}`;
    const row = this.#sql
      .exec("SELECT v FROM ephemeral WHERE k = ? AND expires_at > ?", key, now)
      .toArray()[0];
    if (row) return Promise.resolve(row.v as string);
    const value = randomHex(16);
    this.#sql.exec(
      "INSERT OR REPLACE INTO ephemeral (k, v, expires_at) VALUES (?, ?, ?)",
      key,
      value,
      now + ttlSeconds * 1000,
    );
    return Promise.resolve(value);
  }

  sweep(now: number): Promise<void> {
    this.#sql.exec("DELETE FROM ephemeral WHERE expires_at <= ?", now);
    return Promise.resolve();
  }
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}
