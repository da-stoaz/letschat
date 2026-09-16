# Coding Rules

- There is no such thing as backwards compatibility of a user-facing graphical
  interface. Backwards compatibility can only ever apply to **data, API
  endpoints, and SpacetimeDB reducers** — never to `.tsx` component names, file
  names, or UI structure. Rename components and files freely.
- Never edit `src/generated/` by hand; regenerate it from `server/` with
  `bun run spacetime:generate`.
- Treat the client as untrusted. UI checks do not replace authorization in a
  `core-api` endpoint or SpacetimeDB reducer. See [`SECURITY.md`](SECURITY.md).
- Use additive SpacetimeDB schema changes unless a tested archive rebuild is
  part of the migration. Never bypass a destructive publish prompt casually.
