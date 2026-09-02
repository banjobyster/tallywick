/**
 * Environment parsing.
 *
 * {@link parseConfig} turns a plain string map into a {@link Config}. It throws
 * {@link ConfigError} for malformed values so a broken deployment fails at start
 * rather than per request. It collects softer notes in `warnings`.
 */

import type { Config, DedupMode, LogLevel, OriginRule } from "./types.ts";
import { DEFAULT_BOT_PATTERN } from "./bots.ts";

/** Thrown when an environment value cannot be used. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Result of {@link parseConfig}. */
export interface ParsedConfig {
  config: Config;
  /** Non fatal notes worth logging once at start. */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

const DEFAULT_KEY_PATTERN = "^[A-Za-z0-9._-]{1,64}$";

function str(env: Env, name: string, fallback: string): string {
  const v = env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  throw new ConfigError(`${name} must be a boolean, got ${JSON.stringify(v)}`);
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(
      `${name} must be an integer in [${min}, ${max}], got ${JSON.stringify(v)}`,
    );
  }
  return n;
}

function float(env: Env, name: string, fallback: number, min: number, max: number): number {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be a number in [${min}, ${max}], got ${JSON.stringify(v)}`);
  }
  return n;
}

function regex(env: Env, name: string, fallback: string): { re: RegExp; source: string } {
  const source = str(env, name, fallback);
  try {
    return { re: new RegExp(source), source };
  } catch (e) {
    throw new ConfigError(`${name} is not a valid regular expression: ${(e as Error).message}`);
  }
}

function csv(env: Env, name: string): string[] {
  return str(env, name, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse `ALLOWED_ORIGINS` into match rules. */
export function parseOrigins(raw: string): OriginRule[] {
  const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0 || parts.includes("*")) return [{ any: true }];
  return parts.map((p) => {
    if (p.startsWith("*.")) return { any: false, suffix: p.slice(1).toLowerCase() };
    return { any: false, exact: p.replace(/\/+$/, "").toLowerCase() };
  });
}

const DEDUP_MODES: DedupMode[] = ["none", "ip-hour", "ip-day"];
const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * Build a {@link Config} from an environment map.
 *
 * @param env process or worker environment
 * @param opts `version` is surfaced on the root and health routes
 */
export function parseConfig(env: Env, opts: { version?: string } = {}): ParsedConfig {
  const warnings: string[] = [];

  const allowedOriginsRaw = str(env, "ALLOWED_ORIGINS", "*");
  const allowedOrigins = parseOrigins(allowedOriginsRaw);
  if (allowedOrigins.some((r) => r.any)) {
    warnings.push(
      "ALLOWED_ORIGINS is not set, so any website can read your counts from a browser. " +
        "Set it to your site origin to restrict cross origin reads.",
    );
  }

  const dedupRaw = str(env, "DEDUP", "none");
  if (!DEDUP_MODES.includes(dedupRaw as DedupMode)) {
    throw new ConfigError(
      `DEDUP must be one of ${DEDUP_MODES.join(", ")}, got ${JSON.stringify(dedupRaw)}`,
    );
  }

  const logLevelRaw = str(env, "LOG_LEVEL", "info");
  if (!LOG_LEVELS.includes(logLevelRaw as LogLevel)) {
    throw new ConfigError(
      `LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got ${JSON.stringify(logLevelRaw)}`,
    );
  }

  const key = regex(env, "KEY_PATTERN", DEFAULT_KEY_PATTERN);
  const bot = regex(env, "BOT_PATTERN", DEFAULT_BOT_PATTERN.source);

  const adminTokenRaw = str(env, "ADMIN_TOKEN", "");
  if (adminTokenRaw !== "" && adminTokenRaw.length < 16) {
    warnings.push("ADMIN_TOKEN is shorter than 16 characters. Use a long random value.");
  }

  const namespaceAllowlist = csv(env, "NAMESPACE_ALLOWLIST");

  const config: Config = {
    allowedOrigins,
    allowedOriginsRaw,
    autoCreate: bool(env, "AUTO_CREATE", true),
    namespaceAllowlist: namespaceAllowlist.length > 0 ? namespaceAllowlist : null,
    keyPattern: key.re,
    keyPatternSource: key.source,
    maxNamespaces: int(env, "MAX_NAMESPACES", 50, 0, 1_000_000),
    maxCounters: int(env, "MAX_COUNTERS", 5000, 0, 100_000_000),
    maxIncrement: int(env, "MAX_INCREMENT", 100, 1, 1_000_000_000),
    dedup: dedupRaw as DedupMode,
    requirePost: bool(env, "REQUIRE_POST", false),
    rateLimit: int(env, "RATE_LIMIT", 60, 0, 1_000_000),
    rateWindowSeconds: int(env, "RATE_WINDOW_SECONDS", 60, 1, 86_400),
    ignoreBots: bool(env, "IGNORE_BOTS", false),
    botPattern: bot.re,
    ipSalt: adminOrNull(str(env, "IP_SALT", "")),
    adminToken: adminOrNull(adminTokenRaw),
    readOnly: bool(env, "READONLY", false),
    badgeCacheSeconds: int(env, "BADGE_CACHE_SECONDS", 300, 0, 31_536_000),
    corsMaxAge: int(env, "CORS_MAX_AGE", 86_400, 0, 31_536_000),
    maxBodyBytes: int(env, "MAX_BODY_BYTES", 16_384, 0, 10_485_760),
    logLevel: logLevelRaw as LogLevel,
    logSample: float(env, "LOG_SAMPLE", 1, 0, 1),
    version: opts.version ?? "0.0.0",
  };

  return { config, warnings };
}

function adminOrNull(s: string): string | null {
  return s === "" ? null : s;
}
