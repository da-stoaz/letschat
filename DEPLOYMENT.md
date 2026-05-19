# LetsChat Deployment Index

Full tutorial (beginner step-by-step):

- Astro page: `/self-hosting` (source: `site/src/pages/self-hosting.astro`)
- Local preview URL: `http://localhost:4321/self-hosting`

Use this file as a compact operator reference.

> **Backend service:** the production stack described here deploys the Rust
> `auth-service` (SQLite). `core-api` (.NET / ASP.NET Core Identity +
> PostgreSQL) is the Phase-1 rebuild from `.claude/plans/1-control-panel.md` —
> built and verified, but **not yet wired into these production compose files**.
> When it is cut over, the `auth` service image, the `auth_data` volume, and the
> backups list below change accordingly.

## Production Compose Entry Points

Shared core services:

- `docker-compose.prod.base.yml`

Topology overlays:

- Cloudflare Tunnel: `docker-compose.prod.tunnel.yml`
- Caddy reverse proxy: `docker-compose.prod.caddy.yml`

### Tunnel track

```bash
cp .env.production.tunnel.example .env
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.tunnel.yml up -d --build
```

### Caddy track

```bash
cp .env.production.caddy.example .env
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml up -d --build
```

Validate config before start:

```bash
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.tunnel.yml config >/tmp/letschat-tunnel-config.yml
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml config >/tmp/letschat-caddy-config.yml
```

## SpacetimeDB Publish (Production)

After the stack is up, publish the module:

```bash
spacetime publish --server http://127.0.0.1:44300 letschat --module-path server --yes
```

`--yes` is safe for the **first** publish of a fresh deployment. For later
schema updates, drop `--yes` so SpacetimeDB prompts before any destructive
migration instead of wiping data.

## Service / Env Reference

| Area | Key env / file | Notes |
|---|---|---|
| Auth | `AUTH_JWT_SECRET` | Required in both tracks |
| Auth admin | `AUTH_ADMIN_API_KEY` | Optional; enables explicit host-admin account rebinding endpoint |
| LiveKit | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `livekit/config.prod.yaml` | Keys must match exactly |
| MinIO | `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_PUBLIC_ENDPOINT` | Public endpoint is used in presigned URLs |
| Discovery JSON | `DISCOVERY_SPACETIMEDB_URI`, `DISCOVERY_AUTH_URL`, `DISCOVERY_LIVEKIT_URL`, `DISCOVERY_DATABASE` | Served by `discovery` container at `/.well-known/letschat.json` |
| Tunnel only | `CLOUDFLARE_TUNNEL_TOKEN` | Required by `cloudflared` service |
| Caddy only | `AUTH_DOMAIN`, `CHAT_DOMAIN`, `FILES_DOMAIN`, `LIVEKIT_DOMAIN`, `CONNECT_DOMAIN` | Used by `deploy/caddy/Caddyfile` |

## Discovery Contract (`/.well-known/letschat.json`)

LetsChat setup auto-discovery expects this shape:

```json
{
  "spacetimedb": "wss://chat.example.com",
  "auth": "https://auth.example.com",
  "livekit": "wss://lk.example.com",
  "database": "letschat"
}
```

LiveKit scheme by track:

- Tunnel track: usually `ws://lk.<domain>:44380`
- Caddy track: usually `wss://lk.<domain>`

Quick validation:

```bash
curl -i http://127.0.0.1:44305/.well-known/letschat.json
```

Public routing:

- Tunnel track: add `connect.<domain> -> http://discovery:80` ingress in Cloudflare Tunnel.
- Caddy track: set `CONNECT_DOMAIN` and ensure DNS points to host IP.

Template file:

- `deploy/examples/letschat.well-known.json.example`

## Operations Basics

Tunnel update cycle:

```bash
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.tunnel.yml pull
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.tunnel.yml up -d
```

Caddy update cycle:

```bash
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml pull
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml up -d
```

Minimum backups:

- `auth_data` volume (auth SQLite)
- `minio_data` volume (attachments)
- `spacetimedb_home` volume
