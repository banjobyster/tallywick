/**
 * Shared types for tallywick core.
 *
 * The core is platform neutral. It talks to a {@link Store} and never imports a
 * runtime API. Adapters provide the Store and a small {@link HandlerContext}.
 */

/** One counter as held by a Store. Values are non negative. */
export interface CounterRecord {
  /** Full counter name, `namespace + "/" + key`. */
  name: string;
  /** Current value. Non negative. */
  value: bigint;
  /** Epoch milliseconds when the counter was first created. */
  createdAt: number;
  /** Epoch milliseconds of the most recent change. */
  updatedAt: number;
}

/** Result of {@link Store.increment}. */
export interface IncrementResult extends CounterRecord {
  /** True when this call created the counter. */
  created: boolean;
}

/** Aggregate figures for cap checks and the stats route. */
export interface StoreStats {
  /** Number of distinct counters. */
  counters: number;
  /** Number of distinct namespaces. */
  namespaces: number;
  /** Sum of every counter value. */
  totalHits: bigint;
}

/** Result of {@link Store.rate}. */
export interface RateResult {
  /** False when the caller is over the limit for the current window. */
  allowed: boolean;
  /** Requests still permitted in the current window. Never below zero. */
  remaining: number;
  /** Seconds until the current window resets. */
  resetSeconds: number;
}

/**
 * Storage contract. One instance backs one deployment.
 *
 * Counter operations must be exact under concurrency. `increment` in particular
 * must not lose updates when called in parallel for the same name.
 *
 * Ephemeral operations (`seen`, `rate`, `secret`) may be approximate under a
 * race, since their only effect is deduplication, throttling, and salt reuse.
 */
export interface Store {
  /** Return the counter, or null when it does not exist. Never creates. */
  read(name: string): Promise<CounterRecord | null>;

  /** True when at least one counter exists in `namespace`. Used by cap checks. */
  hasNamespace(namespace: string): Promise<boolean>;

  /**
   * Add `delta` (>= 1n) to the counter, creating it at `delta` when absent.
   * Returns the value after the change and whether it was created.
   */
  increment(name: string, delta: bigint, now: number): Promise<IncrementResult>;

  /** Set the counter to an exact value, creating it when absent. */
  write(name: string, value: bigint, now: number): Promise<CounterRecord>;

  /** Delete the counter. No error when it is already gone. */
  remove(name: string): Promise<void>;

  /** Iterate every counter. Used by the export and stats routes. */
  list(): AsyncIterable<CounterRecord>;

  /**
   * Fast counts for the cap checks on the hit path. Implementations should keep
   * these cheap, from a running total rather than a scan.
   */
  counts(): Promise<{ counters: number; namespaces: number }>;

  /**
   * Full aggregate figures for the stats route. May be O(counters). Not called
   * on the hit path.
   */
  stats(): Promise<StoreStats>;

  /**
   * Record `token` with a time to live. Return true when it was already
   * present. Implementations should make the check and the write atomic.
   */
  seen(token: string, ttlSeconds: number): Promise<boolean>;

  /**
   * Count one request against `token` for a fixed window of `windowSeconds`
   * and report whether the caller is still under `max`.
   */
  rate(token: string, windowSeconds: number, max: number): Promise<RateResult>;

  /**
   * Return a stable random string for `name`, creating one with the given time
   * to live when absent. Used for the rotating daily IP salt.
   */
  secret(name: string, ttlSeconds: number): Promise<string>;

  /** Delete expired ephemeral rows. A no op where the backend expires its own. */
  sweep(now: number): Promise<void>;
}

/** Deduplication window. */
export type DedupMode = "none" | "ip-hour" | "ip-day";

/** Log verbosity. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** One parsed CORS allow rule. */
export interface OriginRule {
  /** Match any origin. */
  any: boolean;
  /** Exact origin, lower cased, no trailing slash. */
  exact?: string;
  /** Wildcard host suffix, for `*.example.com` written as `.example.com`. */
  suffix?: string;
}

/** Fully resolved configuration. Produced by {@link parseConfig}. */
export interface Config {
  allowedOrigins: OriginRule[];
  allowedOriginsRaw: string;
  autoCreate: boolean;
  namespaceAllowlist: string[] | null;
  keyPattern: RegExp;
  keyPatternSource: string;
  maxNamespaces: number;
  maxCounters: number;
  maxIncrement: number;
  dedup: DedupMode;
  requirePost: boolean;
  rateLimit: number;
  rateWindowSeconds: number;
  ignoreBots: boolean;
  botPattern: RegExp;
  ipSalt: string | null;
  adminToken: string | null;
  readOnly: boolean;
  badgeCacheSeconds: number;
  corsMaxAge: number;
  maxBodyBytes: number;
  logLevel: LogLevel;
  logSample: number;
  version: string;
}

/** One structured log line emitted by the handler. */
export interface LogEntry {
  level: LogLevel;
  msg: string;
  route?: string;
  status?: number;
  namespace?: string;
  key?: string;
  counted?: boolean;
  bot?: boolean;
  durMs?: number;
  [extra: string]: unknown;
}

/** Platform hooks passed to {@link handle}. Every field is optional. */
export interface HandlerContext {
  /** Clock. Defaults to `Date.now`. */
  now?: () => number;
  /** Extract the client IP from the request. Defaults to common headers. */
  clientIp?: (req: Request) => string | null;
  /** Schedule background work that outlives the response. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Sink for structured logs. Defaults to `console`. */
  log?: (entry: LogEntry) => void;
  /** Short backend name surfaced on the health route, such as `deno-kv`. */
  storageLabel?: string;
}
