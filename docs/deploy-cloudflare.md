# Deploy to Cloudflare Workers

The Worker at `adapters/cloudflare/src/worker.ts` forwards every request to a
Durable Object that owns a SQLite database. `wrangler.jsonc` already declares the
binding and the migration.

## Steps

1. Push this repository to your own GitHub account, or fork it.

2. Install dependencies and sign in.

   ```bash
   cd adapters/cloudflare
   npm install
   npx wrangler login
   ```

3. Set configuration. Edit the `vars` block in `wrangler.jsonc` for plain
   values. Set secrets out of band.

   ```bash
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put IP_SALT      # optional
   ```

4. Deploy.

   ```bash
   npx wrangler deploy
   ```

   The Worker gets a URL such as `https://tallywick.<subdomain>.workers.dev`.

## Verify

```bash
curl https://tallywick.<subdomain>.workers.dev/v1/hit/example/home
curl https://tallywick.<subdomain>.workers.dev/v1/hit/example/home
curl https://tallywick.<subdomain>.workers.dev/healthz   # storage is "cloudflare-do-sqlite"
```

## Local development

```bash
cd adapters/cloudflare
npx wrangler dev
```

This runs the Worker and a real SQLite Durable Object locally under workerd.

## Notes

- The free plan allows 100,000 Worker requests per day and 100,000 Durable
  Object row writes per day.
- Do not switch this adapter to Workers KV. Workers KV allows only 1,000 writes
  per day on the free plan and is eventually consistent, so counts would be
  wrong. The Durable Object is single threaded and transactional, so parallel
  hits do not lose counts.
- An hourly Durable Object alarm clears expired dedup, rate, and salt rows.
- Counter values are stored as decimal strings and added with `BigInt`, so
  precision is exact for any 64 bit value and beyond.
- For a very large instance, set `CF_SHARD_BY_NAMESPACE=true` to spread
  namespaces across Durable Objects. Stats and export then cover one namespace
  at a time rather than the whole instance.
