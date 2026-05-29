# LetsChat

Desktop chat app built with:

- `server/`: SpacetimeDB Rust module (chat data + permissions)
- `auth-service/`: Rust auth API (`auth-framework` + SQLite) — the current production backend service
- `core-api/`: .NET / ASP.NET Core Identity + PostgreSQL rebuild of the backend service (Phase 1 of `.claude/plans/1-control-panel.md`; built and dev-runnable, not yet cut over to production — see `core-api/README.md`)
- `src-tauri/`: Tauri shell
- `src/`: React + TypeScript frontend

## Self-Hosting Backend

- Full step-by-step guide: `/self-hosting` on the Astro site (`site/src/pages/self-hosting.astro`)
- Operator quick reference: `DEPLOYMENT.md`

## Local Dev Flow

1. Start all supporting services (SpacetimeDB, LiveKit, MinIO, PostgreSQL):

```bash
bun run services:up
```

2. Publish the SpacetimeDB module (only needed once, or after `server/` changes):

```bash
bun run spacetime:publish
```

3. Start the backend service (`.env.development` is loaded automatically via `APP_ENV=dev`):

```bash
bun run auth:dev        # Rust auth-service
# or
bun run core-api:dev    # .NET core-api (needs the PostgreSQL container)
```

4. Start the app:

```bash
bun run tauri dev
```

## Service Helpers

```bash
bun run services:logs
bun run services:down
bun run services:reset
```

## Auth Service Environment

- `AUTH_BIND` (default: `127.0.0.1:8787`)
- `AUTH_DATABASE_URL` — Rust auth-service: `sqlite://auth-service/auth.db`; core-api: a PostgreSQL connection string
- `AUTH_JWT_SECRET` (set this in real deployments)
- `AUTH_ADMIN_API_KEY` (optional; enables `/admin/accounts/rebind` for host-admin account rebinding)

The desktop client discovers the backend URL from `/.well-known/letschat.json`; there is no build-time auth URL.
