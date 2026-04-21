# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LetsChat is a Tauri-based desktop chat application with a distributed backend. The stack:

- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS 4, shadcn/ui (via @base-ui/react), Zustand 5 (18 stores), React Router 7, React Query 5
- **Desktop shell**: Tauri 2.8 (wraps the Vite frontend)
- **Real-time database**: SpacetimeDB 2.1.0 — Rust WASM module defines schema and reducers; clients connect via WebSocket
- **Auth service**: Rust (Axum) + SQLite + Argon2 + JWT, runs as a standalone HTTP server
- **Voice/video**: LiveKit 2.15.9
- **File storage**: MinIO (S3-compatible), presigned URLs for client access

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
- Node.js 22+, Rust 1.88+, Docker + Docker Compose
- SpacetimeDB CLI: `npm install -g @clockworklabs/spacetime`

### Start everything
```bash
npm run services:up       # Start SpacetimeDB (4300), LiveKit (7880), MinIO (4390)
npm run spacetime:publish # Publish WASM module to SpacetimeDB (run once, or after server/ changes)
npm run auth:dev          # Start auth service (127.0.0.1:8787), loads .env.development
npm run tauri dev         # Start Tauri dev window with Vite hot-reload
```

### Reset state
```bash
npm run services:reset    # Stop containers and remove volumes (fresh state)
```

## Commands

| Task | Command |
|------|---------|
| Start dev services | `npm run services:up` |
| Start auth service | `npm run auth:dev` |
| Start desktop app | `npm run tauri dev` |
| Build frontend | `npm run build` |
| Build Tauri binary | `npm run tauri:build:local` |
| Lint frontend | `npm run lint` |
| Publish SpacetimeDB module | `npm run spacetime:publish` |
| Regenerate TS bindings | `npm run spacetime:generate` |
| View service logs | `npm run services:logs` |

### Building individual services
```bash
# Auth service
cargo build --release --manifest-path auth-service/Cargo.toml

# SpacetimeDB WASM module
cargo build --manifest-path server/Cargo.toml --target wasm32-unknown-unknown --release
```

## Architecture Details

### SpacetimeDB Module (`/server`)
- Schema defined in `server/src/schema.rs` — 13 tables: User, AuthCredential, Server, ServerMember, Channel, Message, Friend, Block, DirectMessage, VoiceParticipant, DmVoiceParticipant, PresenceState, TypingState
- Logic lives in `server/src/reducers/` — each file handles a domain (messages, voice, dm, etc.)
- Client TypeScript bindings are **auto-generated** into `src/generated/` — never edit these manually; regenerate with `npm run spacetime:generate`
- Compiles to WASM (`wasm32-unknown-unknown`) and gets published to the running SpacetimeDB instance

### Auth Service (`/auth-service`)
- Axum HTTP API: register, login, token refresh, LiveKit token generation, admin endpoints
- SQLite database at `auth-service/auth.db`, migrated via `auth-service/migrations/`
- Loads config from `.env.development` (dev) or `.env.production` (prod) based on `APP_ENV`

### Frontend State (`/src/stores`)
- 18 Zustand stores — each domain has its own store
- SpacetimeDB client in `src/lib/spacetimedb-client.ts` — subscribes to tables and feeds data into stores
- Auth helpers in `src/lib/auth.ts`, LiveKit in `src/lib/livekit.ts`, Tauri bridge in `src/lib/tauri.ts`

### Production Deployment
Two supported topologies, both using Docker Compose:
- **Caddy**: `docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml up -d`
- **Cloudflare Tunnel**: `docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.tunnel.yml up -d`

See `.env.production.caddy.example` and `.env.production.tunnel.example` for required env vars.

## Coding Rules

- Backwards compatibility applies only to **data, API endpoints, and SpacetimeDB reducers** — not to component names, file names, or UI structure. Feel free to rename `.tsx` files and components without concern for backwards compatibility.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
