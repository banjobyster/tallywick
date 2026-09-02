# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Core request handler, platform neutral, with a `Store` interface.
- Deno adapter backed by Deno KV, with atomic counter increments.
- Cloudflare adapter backed by a SQLite Durable Object.
- Routes: `hit`, `get`, `badge`, `healthz`, and the admin set `stats`,
  `export`, `import`, `set`, `reset`, `delete`.
- Configuration through environment variables, with validation at start.
- Deduplication modes `ip-hour` and `ip-day`, fixed window rate limiting,
  CORS allow list, bot filtering, counter and namespace caps, read only mode.
- SVG badge renderer with four styles and number abbreviation.
- Browser client and a React hook.
- Storage conformance suite run against the in memory, Deno KV, and SQLite
  backends.
