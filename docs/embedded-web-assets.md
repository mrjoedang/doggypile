# Embedded web assets

## Responsibility and interface

`daemon/crates/doggypile/build.rs` recursively discovers the production files under `web/`, sorts routes deterministically, and generates an embedded catalog. `src/web_assets.rs` is the sole runtime lookup interface: an exact, query-free rooted path maps to bytes, MIME type, and cache policy. `/` is an alias for `/index.html`.

`src/cli/web.rs` is only the HTTP transport adapter. It removes a query string, asks the catalog for an asset, and serializes a 200 or 404 response.

## Owned policy and invariants

- Development mocks, `.bak`/`.backup`/editor backups, and files in test or backup directories are never packaged.
- Under `vendor/iroh`, only the current SHA-256 directory, selected by `current.txt`, is packaged. Legacy unversioned assets remain available.
- Current-version WASM package routes use `public, max-age=31536000, immutable`.
- Ordinary and legacy routes use `no-cache`; unknown versions return no catalog result and therefore HTTP 404.
- Routes are derived from normalized paths relative to `web/` and sorted before code generation.
- MIME policy is extension-based and centralized with lookup.

## Non-responsibilities

The catalog does not parse HTTP, bind sockets, add transport headers, provide directory listings, perform content negotiation, or implement SPA fallback routing. The HTTP adapter does not decide asset membership, MIME types, aliases, or caching.
