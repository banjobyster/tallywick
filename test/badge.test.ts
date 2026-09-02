/** Badge renderer, abbreviation, and colour resolution. */

import { abbreviate, renderBadge, resolveColor } from "../core/badge.ts";
import { assert, assertEquals, assertMatch } from "./assert.ts";

Deno.test("abbreviate formats magnitudes", () => {
  assertEquals(abbreviate(0n), "0");
  assertEquals(abbreviate(999n), "999");
  assertEquals(abbreviate(1000n), "1k");
  assertEquals(abbreviate(1234n), "1.2k");
  assertEquals(abbreviate(12_345n), "12.3k");
  // three digit integer part drops the decimal, and the value truncates
  assertEquals(abbreviate(999_999n), "999k");
  assertEquals(abbreviate(3_400_000n), "3.4M");
  assertEquals(abbreviate(2_000_000_000n), "2B");
  assertEquals(abbreviate(5_000_000_000_000n), "5T");
});

Deno.test("resolveColor accepts names and hex, falls back", () => {
  assertEquals(resolveColor("brightgreen", "#000"), "#4c1");
  assertEquals(resolveColor("blue", "#000"), "#007ec6");
  assertEquals(resolveColor("#abc", "#000"), "#abc");
  assertEquals(resolveColor("abcdef", "#000"), "#abcdef");
  assertEquals(resolveColor("not-a-color", "#111"), "#111");
  assertEquals(resolveColor(undefined, "#222"), "#222");
});

Deno.test("renderBadge produces well formed svg for each style", () => {
  for (const style of ["flat", "flat-square", "plastic", "for-the-badge"] as const) {
    const svg = renderBadge({ label: "views", value: "1.2k", style });
    assertMatch(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assertMatch(svg, /<\/svg>$/);
    assert(svg.includes('aria-label="views: 1.2k"'));
    // width attribute is a positive number
    const w = Number(svg.match(/width="(\d+)"/)?.[1]);
    assert(w > 20, `width should be sensible, got ${w}`);
  }
});

Deno.test("renderBadge escapes special characters", () => {
  const svg = renderBadge({ label: "a<b>&\"'", value: "1" });
  assert(!svg.includes("<b>"));
  assertMatch(svg, /a&lt;b&gt;/);
});

Deno.test("for-the-badge upper cases the text", () => {
  const svg = renderBadge({ label: "views", value: "1k", style: "for-the-badge" });
  assertMatch(svg, />VIEWS<\/text>/);
});
