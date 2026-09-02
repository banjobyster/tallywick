/**
 * Integration tests for the Cloudflare adapter.
 *
 * These run against the real Worker plus a real SQLite Durable Object under
 * workerd, driven by `@cloudflare/vitest-pool-workers`. The storage contract
 * itself is covered by the shared conformance suite in
 * `test/sqlite_store_deno.test.ts`.
 */

/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "https://tallywick.test";

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("tallywick worker", () => {
  it("creates and increments a counter", async () => {
    let res = await SELF.fetch(`${BASE}/v1/hit/site/home`);
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).count).toBe(1);

    res = await SELF.fetch(`${BASE}/v1/hit/site/home`);
    expect((await jsonOf(res)).count).toBe(2);

    res = await SELF.fetch(`${BASE}/v1/get/site/home`);
    expect((await jsonOf(res)).count).toBe(2);
  });

  it("get does not create a counter", async () => {
    const res = await SELF.fetch(`${BASE}/v1/get/never/made`);
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.count).toBe(0);
    expect(body.updated).toBe(null);
  });

  it("renders an svg badge without incrementing", async () => {
    await SELF.fetch(`${BASE}/v1/hit/badges/downloads`);
    const res = await SELF.fetch(`${BASE}/v1/badge/badges/downloads.svg?label=downloads`);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain("<svg");
    expect(svg).toContain("downloads");

    const after = await jsonOf(await SELF.fetch(`${BASE}/v1/get/badges/downloads`));
    expect(after.count).toBe(1);
  });

  it("reports the sqlite backend on healthz", async () => {
    const res = await SELF.fetch(`${BASE}/healthz`);
    expect((await jsonOf(res)).storage).toBe("cloudflare-do-sqlite");
  });

  it("rejects an invalid key", async () => {
    const res = await SELF.fetch(`${BASE}/v1/hit/site/has%20space`);
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).code).toBe("bad_key");
  });

  it("keeps admin routes invisible without a token", async () => {
    const res = await SELF.fetch(`${BASE}/v1/stats`);
    expect(res.status).toBe(404);
  });

  it("increments by a bounded amount", async () => {
    const res = await SELF.fetch(`${BASE}/v1/hit/site/downloads?by=10`, { method: "POST" });
    expect((await jsonOf(res)).count).toBe(10);
    const bad = await SELF.fetch(`${BASE}/v1/hit/site/downloads?by=99999`, { method: "POST" });
    expect(bad.status).toBe(400);
  });
});
