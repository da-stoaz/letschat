# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LetsChat is a Tauri-based desktop chat application with a distributed backend. The stack:

- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS 4, shadcn/ui (via @base-ui/react), Zustand 5 (18 stores), React Router 7, React Query 5
- **Desktop shell**: Tauri 2 (wraps the Vite frontend)
- **Real-time database**: SpacetimeDB 2.2 — Rust WASM module defines schema and reducers; clients connect via WebSocket
- **Auth / backend service**: in transition — see "Auth service" below
- **Voice/video**: LiveKit (`livekit-client` 2.19)
- **File storage**: MinIO (S3-compatible), presigned URLs for client access

### Auth service — in transition

Two implementations of the backend HTTP service exist:

- **`auth-service/`** — the original Rust (Axum) + SQLite + Argon2 + JWT service. **This is still the production service.**
- **`core-api/`** — a .NET / ASP.NET Core Identity + PostgreSQL rebuild (Phase 1 of `.claude/plans/1-control-panel.md`). Built and verified, runnable in dev, but **not yet cut over to production**. See `core-api/README.md`.

Both expose the same HTTP/JSON contract on `127.0.0.1:8787`, so the desktop client works against either. Until the cutover, `auth-service/` is authoritative; run only one at a time.

### Service Communication

```
[Client]
  ├─→ Auth Service (HTTP) — JWT tokens, LiveKit tokens, file upload presigned URLs
  ├─→ SpacetimeDB (WebSocket) — real-time DB, permissions enforcement via reducers
  ├─→ LiveKit (WebSocket) — voice/video signaling
  └─→ MinIO (S3 API) — file upload/download via presigned URLs
```

Auto-discovery via `/.well-known/letschat.json` on the `connect.<domain>` subdomain lets the client find service endpoints.

## Local Development

### Prerequisites
- Bun 1.3+, Rust 1.88+, Docker + Docker Compose
- .NET 10 SDK — only needed to build/run `core-api`
- SpacetimeDB CLI — install with `curl -sSf https://install.spacetimedb.com | sh`; update with `spacetime version upgrade`. Keep the CLI, the `spacetimedb` npm SDK, and the server image on the **same 2.2.x line** — a minor-version skew breaks the client connection.

### Start everything
```bash
bun run services:up       # Start SpacetimeDB (4300), LiveKit (7880), MinIO (4390), PostgreSQL (5433)
bun run spacetime:publish # Publish WASM module to SpacetimeDB (run once, or after server/ changes)
bun run auth:dev          # Start the Rust auth-service (127.0.0.1:8787)
# — or, to run the .NET rebuild instead of auth:dev —
bun run core-api:dev      # Start core-api (127.0.0.1:8787); needs the PostgreSQL container
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
| Start Rust auth-service | `bun run auth:dev` |
| Start .NET core-api | `bun run core-api:dev` |
| Run core-api tests | `bun run core-api:test` |
| Migrate auth-service SQLite → core-api PostgreSQL | `bun run core-api:migrate` |
| Start desktop app | `bun run tauri dev` |
| Build frontend | `bun run build` |
| Build Tauri binary | `bun run tauri:build:local` |
| Lint frontend | `bun run lint` |
| Publish SpacetimeDB module | `bun run spacetime:publish` |
| Regenerate TS bindings | `bun run spacetime:generate` |
| View service logs | `bun run services:logs` |

### Building individual services
```bash
# Rust auth-service
cargo build --release --manifest-path auth-service/Cargo.toml

# .NET core-api
dotnet build core-api/CoreApi.slnx

# SpacetimeDB WASM module
cargo build --manifest-path server/Cargo.toml --target wasm32-unknown-unknown --release
```

## Architecture Details

### SpacetimeDB Module (`/server`)
- Schema defined in `server/src/schema.rs`; the table list lives there (User, AuthCredential, Server, ServerMember, Channel, Message, Friend, Block, DirectMessage, voice/DM/presence/typing/read-state tables, …).
- Logic lives in `server/src/reducers/` — each file handles a domain (messages, voice, dm, etc.)
- Client TypeScript bindings are **auto-generated** into `src/generated/` — never edit these manually; regenerate with `bun run spacetime:generate`
- Compiles to WASM (`wasm32-unknown-unknown`) and gets published to the running SpacetimeDB instance
- **Schema migration safety:** `bun run spacetime:publish` is the safe command — it has NO `--yes` flag, so SpacetimeDB will prompt before destructive migrations instead of silently wiping data. If a publish stops on a "requires deleting data" prompt, the schema change is incompatible: fix it by making new fields `Option<T>` or adding `#[default(...)]`, do not bypass the prompt. `bun run spacetime:reset` is the explicit nuke (uses `--delete-data --yes`) for intentional clean slates only.

### Auth services
- **`auth-service/`** (Rust) — Axum HTTP API: register, login, token refresh, LiveKit token generation, file-upload presigned URLs, admin endpoints. SQLite database at `auth-service/auth.db`, migrated via `auth-service/migrations/`. Loads config from `.env.development` (dev) or `.env.production` (prod) based on `APP_ENV`.
- **`core-api/`** (.NET) — the same endpoints rebuilt on ASP.NET Core Identity + PostgreSQL (the `auth` database, dev port `5433`). EF Core migrations are applied on startup. See `core-api/README.md` for layout, config, and the data-migration tool.

### Frontend State (`/src/stores`)
- 18 Zustand stores — each domain has its own store
- SpacetimeDB client lives in `src/lib/spacetimedb/` (`connection.ts`, `auth.ts`, generated-table wiring) — subscribes to tables and feeds data into stores
- Auth-service client in `src/lib/authService.ts`, LiveKit in `src/lib/livekit.ts`, Tauri bridge in `src/lib/tauri.ts`

### Production Deployment
Two supported topologies, both using Docker Compose (currently deploying the Rust `auth-service`):
- **Caddy**: `docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml up -d`
- **Cloudflare Tunnel**: `docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.tunnel.yml up -d`

See `.env.production.caddy.example` and `.env.production.tunnel.example` for required env vars, and `DEPLOYMENT.md` for the operator reference.

## Coding Rules

- Backwards compatibility applies only to **data, API endpoints, and SpacetimeDB reducers** — not to component names, file names, or UI structure. Feel free to rename `.tsx` files and components without concern for backwards compatibility.
