# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LetsChat is a Tauri-based desktop chat application with a distributed backend. The stack:

- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS 4, shadcn/ui (via @base-ui/react), Zustand 5 (18 stores), React Router 7, React Query 5
- **Desktop shell**: Tauri 2 (wraps the Vite frontend)
- **Real-time database**: SpacetimeDB 2.5 — Rust WASM module defines schema and reducers; clients connect via WebSocket
- **Backend service**: `core-api` — .NET 10 / ASP.NET Core Identity + PostgreSQL. Public API on `127.0.0.1:8787`; admin Razor pages on the separate `127.0.0.1:8788` listener.
- **Voice/video**: LiveKit (`livekit-client` 2.19)
- **File storage**: MinIO (S3-compatible), presigned URLs for client access

### Auth service — cutover done

`core-api/` (.NET) is the sole auth backend in dev and prod. The legacy Rust `auth-service/` has been **removed**. The one-time SQLite→Postgres migration tool (`core-api/tools/CoreApi.Migrator`) is **retained** for importing a legacy `auth.db` if one still exists on an old machine — point it at the file with `bun run core-api:migrate`.

### Service Communication

```
[Client]
  ├─→ core-api (HTTP) — JWT tokens, LiveKit tokens, file upload presigned URLs,
  │                     admin panel (on a separate non-public listener)
  ├─→ SpacetimeDB (WebSocket) — real-time DB, permissions enforcement via reducers
  ├─→ LiveKit (WebSocket) — voice/video signaling
  └─→ MinIO (S3 API) — file upload/download via presigned URLs
```

Auto-discovery via `/.well-known/letschat.json` on the `auth.<domain>` subdomain lets the client find service endpoints.

## Local Development

### Prerequisites
- Bun 1.3+, Rust 1.88+, Docker + Docker Compose
- .NET 10 SDK — only needed to build/run `core-api`
- SpacetimeDB CLI — install with `curl -sSf https://install.spacetimedb.com | sh`; update with `spacetime version upgrade`. Keep the CLI, the `spacetimedb` npm SDK, the `spacetimedb` Rust crate, and the server image on the **same 2.5.x line** — a minor-version skew breaks module load and the client connection.

### Start everything
```bash
bun run services:up       # Start SpacetimeDB (4300), LiveKit (7880), MinIO (4390), PostgreSQL (5433)
bun run spacetime:publish # Publish WASM module to SpacetimeDB (run once, or after server/ changes)
bun run core-api:dev      # Start core-api (127.0.0.1:8787 public, :8788 admin)
bun run tauri dev         # Start Tauri dev window with Vite hot-reload
```

### Reset state
```bash
bun run services:reset    # Stop containers and remove volumes (fresh state)
```

## Commands

| Task | Command |
|------|---------|
| Start dev services | `bun run services:up` |
| Start core-api (authoritative) | `bun run core-api:dev` |
| Run core-api tests | `bun run core-api:test` |
| Import a legacy `auth.db` → core-api PostgreSQL (one-time, if you have one) | `bun run core-api:migrate` |
| Start desktop app | `bun run tauri dev` |
| Build frontend | `bun run build` |
| Build Tauri binary | `bun run tauri:build:local` |
| Lint frontend | `bun run lint` |
| Run security tests (SpacetimeDB table-visibility) | `bun run test:security` (needs services up) |
| Run all Vitest tests | `bun run test` |
| Publish SpacetimeDB module | `bun run spacetime:publish` |
| Regenerate TS bindings | `bun run spacetime:generate` |
| View service logs | `bun run services:logs` |

### Building individual services
```bash
# .NET core-api (authoritative auth backend)
dotnet build core-api/CoreApi.slnx

# SpacetimeDB WASM module
cargo build --manifest-path server/Cargo.toml --target wasm32-unknown-unknown --release
```

## Architecture Details

### SpacetimeDB Module (`/server`)
- Schema defined in `server/src/schema.rs`; the table list lives there (User, Server, ServerMember, Channel, Message, Friend, Block, DirectMessage, voice/DM/presence/typing/read-state tables, …).
- Logic lives in `server/src/reducers/` — each file handles a domain (messages, voice, dm, etc.)
- Client TypeScript bindings are **auto-generated** into `src/generated/` — never edit these manually; regenerate with `bun run spacetime:generate`
- Compiles to WASM (`wasm32-unknown-unknown`) and gets published to the running SpacetimeDB instance
- **Schema migration safety:** `bun run spacetime:publish` is the safe command — it has NO `--yes` flag, so SpacetimeDB will prompt before destructive migrations instead of silently wiping data. If a publish stops on a "requires deleting data" prompt, the schema change is incompatible: fix it by making new fields `Option<T>` or adding `#[default(...)]`, do not bypass the prompt. `bun run spacetime:reset` is the explicit nuke (uses `--delete-data --yes`) for intentional clean slates only.

### Auth backend
- **`core-api/`** (.NET 10) — the sole auth backend. ASP.NET Core Identity + PostgreSQL (the `auth` database, dev port `5433`). EF Core migrations are applied on startup. Public API endpoints (register/login/refresh/livekit/uploads/well-known/downloads) on `AUTH_BIND`; admin Razor pages on the separate `ADMIN_BIND` listener that the public reverse proxy is **not** configured to expose. Integration tests in `core-api/tests/CoreApi.Tests/IntegrationTests/`. See `core-api/README.md` for layout, config, and the migration tool.
- The legacy Rust `auth-service/` has been removed. `core-api/tools/CoreApi.Migrator` remains as the one-time importer for a legacy `auth.db` (SQLite → the Postgres `auth` database), should an old one ever need migrating.

### Frontend State (`/src/stores`)
- 18 Zustand stores — each domain has its own store
- SpacetimeDB client lives in `src/lib/spacetimedb/` (`connection.ts`, `auth.ts`, generated-table wiring) — subscribes to tables and feeds data into stores
- Auth-service client in `src/lib/authService.ts`, LiveKit in `src/lib/livekit.ts`, Tauri bridge in `src/lib/tauri.ts`

### Production Deployment
Two supported topologies, both using Docker Compose:
- **Caddy**: `docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml up -d`
- **Cloudflare Tunnel**: `docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.tunnel.yml up -d`

See `.env.production.caddy.example` and `.env.production.tunnel.example` for required env vars, and `DEPLOYMENT.md` for the operator reference.

## Coding Rules

- Backwards compatibility applies only to **data, API endpoints, and SpacetimeDB reducers** — not to component names, file names, or UI structure. Feel free to rename `.tsx` files and components without concern for backwards compatibility.
