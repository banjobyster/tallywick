# Deploy to Deno Deploy

Deno Deploy runs the entrypoint at `adapters/deno/main.ts`. It needs a Deno KV
database.

## Steps

1. Push this repository to your own GitHub account, or fork it.

2. At [console.deno.com](https://console.deno.com), create an organization if you
   do not have one, then create a new app from the repository. Set the entry
   point to `adapters/deno/main.ts`.

3. Provision a database. In the organization view, open **Databases**, choose
   **Provision Database**, pick **Deno KV** as the engine, name it, and save.
   From the database list, click **Assign** and select your app. After it is
   assigned, `Deno.openKv()` in the code connects to it with no further wiring.

4. Set environment variables on the app. At a minimum set `ALLOWED_ORIGINS` to
   your site origin. Set `ADMIN_TOKEN` to a long random value if you want the
   admin routes.

5. Deploy. The app gets a URL such as `https://tallywick-xxxx.deno.dev`.

## Verify

```bash
curl https://tallywick-xxxx.deno.dev/v1/hit/example/home
curl https://tallywick-xxxx.deno.dev/v1/hit/example/home   # count goes up
curl https://tallywick-xxxx.deno.dev/v1/get/example/home   # count unchanged
curl https://tallywick-xxxx.deno.dev/healthz               # storage is "deno-kv"
```

## Local development

```bash
deno task dev
```

This serves on `http://localhost:8000`. With no `TALLYWICK_KV_PATH` set, it uses
a local file backed KV in the default Deno location. Set `TALLYWICK_KV_PATH` to
a path to choose the file, or to `:memory:` for a throwaway store.

## Notes

- The free plan allows roughly 1,000,000 requests and 500,000 KV write units per
  month. One `hit` is one write unit, or two in a dedup mode.
- Counter increments use `sum` on a `Deno.KvU64`, which is atomic per key on
  Deno Deploy. Parallel hits do not lose counts.
- Every ephemeral key carries an expiry, so there is no cleanup job.
