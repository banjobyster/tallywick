/** Environment parsing. */

import { ConfigError, parseConfig, parseOrigins } from "../core/config.ts";
import { originAllowed } from "../core/cors.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("defaults are applied", () => {
  const { config, warnings } = parseConfig({});
  assertEquals(config.autoCreate, true);
  assertEquals(config.dedup, "none");
  assertEquals(config.rateLimit, 60);
  assertEquals(config.maxCounters, 5000);
  assertEquals(config.adminToken, null);
  assert(warnings.some((w) => w.includes("ALLOWED_ORIGINS")));
});

Deno.test("booleans accept common spellings", () => {
  assertEquals(parseConfig({ AUTO_CREATE: "no" }).config.autoCreate, false);
  assertEquals(parseConfig({ AUTO_CREATE: "ON" }).config.autoCreate, true);
  assertEquals(parseConfig({ READONLY: "1" }).config.readOnly, true);
});

Deno.test("bad values throw ConfigError", () => {
  let threw = false;
  try {
    parseConfig({ RATE_LIMIT: "-5" });
  } catch (e) {
    threw = e instanceof ConfigError;
  }
  assert(threw);

  threw = false;
  try {
    parseConfig({ DEDUP: "weekly" });
  } catch (e) {
    threw = e instanceof ConfigError;
  }
  assert(threw);

  threw = false;
  try {
    parseConfig({ KEY_PATTERN: "([" });
  } catch (e) {
    threw = e instanceof ConfigError;
  }
  assert(threw);
});

Deno.test("origin parsing and matching", () => {
  assertEquals(parseOrigins("*"), [{ any: true }]);
  assertEquals(parseOrigins(""), [{ any: true }]);

  const rules = parseOrigins("https://a.com, *.b.com");
  assert(originAllowed("https://a.com", rules));
  assert(originAllowed("https://a.com/", rules));
  assert(!originAllowed("https://a.com.evil.com", rules));
  assert(originAllowed("https://x.b.com", rules));
  assert(originAllowed("https://b.com", rules));
  assert(!originAllowed("https://notb.com", rules));
});

Deno.test("short admin token warns but is accepted", () => {
  const { config, warnings } = parseConfig({ ADMIN_TOKEN: "short" });
  assertEquals(config.adminToken, "short");
  assert(warnings.some((w) => w.includes("ADMIN_TOKEN")));
});
