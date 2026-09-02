/** Name and increment validation. */

import { parseConfig } from "../core/config.ts";
import { parseIncrement, splitName, validateName } from "../core/validate.ts";
import { assert, assertEquals } from "./assert.ts";

const config = parseConfig({}).config;

Deno.test("validateName joins and rejects", () => {
  const ok = validateName("portfolio", "home", config);
  assert(ok.ok);
  if (ok.ok) assertEquals(ok.name, "portfolio/home");

  assertEquals(validateName("has space", "home", config).ok, false);
  assertEquals(validateName("portfolio", "a/b", config).ok, false);
  assertEquals(validateName("portfolio", "", config).ok, false);
  assertEquals(validateName("x".repeat(65), "home", config).ok, false);
});

Deno.test("namespace allow list", () => {
  const restricted = parseConfig({ NAMESPACE_ALLOWLIST: "a,b" }).config;
  assertEquals(validateName("a", "home", restricted).ok, true);
  const bad = validateName("c", "home", restricted);
  assertEquals(bad.ok, false);
  if (!bad.ok) assertEquals(bad.code, "namespace_not_allowed");
});

Deno.test("splitName", () => {
  assertEquals(splitName("portfolio/home"), { namespace: "portfolio", key: "home" });
  assertEquals(splitName("solo"), { namespace: "solo", key: "" });
});

Deno.test("parseIncrement bounds", () => {
  assertEquals(parseIncrement(null, 100), { ok: true, value: 1n });
  assertEquals(parseIncrement("", 100), { ok: true, value: 1n });
  assertEquals(parseIncrement("50", 100), { ok: true, value: 50n });
  assertEquals(parseIncrement("100", 100), { ok: true, value: 100n });
  assertEquals(parseIncrement("101", 100), { ok: false });
  assertEquals(parseIncrement("0", 100), { ok: false });
  assertEquals(parseIncrement("-1", 100), { ok: false });
  assertEquals(parseIncrement("1.5", 100), { ok: false });
  assertEquals(parseIncrement("abc", 100), { ok: false });
});
