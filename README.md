# tally

A tiny durable hit counter running on Deno Deploy. One deployment serves
every site, keyed by the URL path.

## API

| Route | Effect |
|---|---|
| `GET /hit/<key>` | Increment, then return `{ "key": "...", "count": N }` |
| `GET /get/<key>` | Return the count without incrementing |

`<key>` is 1 to 64 characters, letters, digits, `_`, `-`, `:`. Increments
use an atomic KV sum, so concurrent hits never lose a count. CORS is open,
so any page can call it from the browser.

## Deploy

1. Push this folder to a GitHub repo.
2. At [dash.deno.com](https://dash.deno.com), sign in with GitHub and create
   a new project from the repo. Entry point `main.ts`.
3. Deno KV is enabled automatically. The project gets a URL like
   `https://tally-xxxx.deno.dev`.

Verify:

```bash
curl https://tally-xxxx.deno.dev/hit/test
curl https://tally-xxxx.deno.dev/hit/test   # count goes up
curl https://tally-xxxx.deno.dev/get/test   # count unchanged
```

## Local development

Needs the Deno runtime installed.

```bash
deno task dev
```

Serves on `http://localhost:8000`. Local runs use a file-backed KV store,
separate from production.

## Keys in use

| Key | Site |
|---|---|
| `portfolio` | banjobyster.github.io |
| `bysters` | banjobyster.github.io/bysters |
