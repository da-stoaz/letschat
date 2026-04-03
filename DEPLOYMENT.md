# LetsChat Deployment Index

Full tutorial (beginner step-by-step):

- Astro page: `/self-hosting` (source: `site/src/pages/self-hosting.astro`)
- Local preview URL: `http://localhost:4321/self-hosting`

Use this file as a compact operator reference.

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

After stack is up, publish the module:

```bash
spacetime publish --server http://127.0.0.1:44300 letschat --module-path server --yes
```

## Service / Env Reference

| Area | Key env / file | Notes |
|---|---|---|
| Auth | `AUTH_JWT_SECRET` | Required in both tracks |
| LiveKit | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `livekit/config.prod.yaml` | Keys must match exactly |
| MinIO | `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_PUBLIC_ENDPOINT` | Public endpoint is used in presigned URLs |
| Tunnel only | `CLOUDFLARE_TUNNEL_TOKEN` | Required by `cloudflared` service |
| Caddy only | `AUTH_DOMAIN`, `CHAT_DOMAIN`, `FILES_DOMAIN`, `LIVEKIT_DOMAIN` | Used by `deploy/caddy/Caddyfile` |

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
