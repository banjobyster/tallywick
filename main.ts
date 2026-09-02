// tally: a tiny durable hit counter.
//
// Runs on Deno Deploy. One deployment serves every site, keyed by the URL path:
//   GET /hit/<key>   increment, then return the count
//   GET /get/<key>   return the count without incrementing
//
// The count lives in Deno KV (built in, free, persistent). Increments go
// through an atomic sum, so concurrent hits never lose a count.

const KV = await Deno.openKv();

const CORS: HeadersInit = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const { pathname } = new URL(req.url);

  if (pathname === "/" || pathname === "") {
    return json({ ok: true, usage: "GET /hit/<key> or GET /get/<key>" });
  }

  // key: 1-64 chars, letters/digits/_-: only
  const match = pathname.match(/^\/(hit|get)\/([A-Za-z0-9_:-]{1,64})$/);
  if (!match) return json({ error: "GET /hit/<key> or GET /get/<key>" }, 404);

  const [, action, key] = match;
  const path = ["tally", key];

  if (action === "hit") {
    await KV.atomic().sum(path, 1n).commit();
  }

  const entry = await KV.get<Deno.KvU64>(path);
  const count = Number(entry.value?.value ?? 0n);

  return json({ key, count });
});
