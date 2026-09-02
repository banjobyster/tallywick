/**
 * tallywick core. Platform neutral request handling for a self hosted hit
 * counter. Import this from an adapter, provide a {@link Store}, and serve
 * {@link handle}.
 */

export { handle } from "./handler.ts";
export { ConfigError, parseConfig, type ParsedConfig, parseOrigins } from "./config.ts";
export { MemoryStore } from "./memory_store.ts";
export {
  abbreviate,
  type BadgeOptions,
  type BadgeStyle,
  renderBadge,
  resolveColor,
} from "./badge.ts";
export { DEFAULT_BOT_PATTERN, isBot } from "./bots.ts";
export { originAllowed } from "./cors.ts";
export { hashIp } from "./ip.ts";
export { parseIncrement, splitName, validateName } from "./validate.ts";

export type {
  Config,
  CounterRecord,
  DedupMode,
  HandlerContext,
  IncrementResult,
  LogEntry,
  LogLevel,
  OriginRule,
  RateResult,
  Store,
  StoreStats,
} from "./types.ts";
