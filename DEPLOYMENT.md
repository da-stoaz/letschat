# LetsChat Deployment Index

Full tutorial (beginner step-by-step):

- Astro page: `/self-hosting` (source: `site/src/pages/self-hosting.astro`)
- Local preview URL: `http://localhost:4321/self-hosting`

Use this file as a compact operator reference.

> **Backend service:** production runs **`core-api`** (.NET / ASP.NET Core
> Identity + PostgreSQL). The legacy Rust `auth-service` has been **removed**
> from the repo; only its migrator (`CoreApi.Migrator`) remains. If you're
> upgrading from an old `auth-service` deployment, hand its SQLite `auth.db` to
> the migrator (**First-time cutover** below) before bringing the new stack up.

## Production Compose Entry Points

Shared core services:

- `docker-compose.prod.base.yml` — `spacetimedb`, `postgres`, `core-api`,
  `module-init`, `livekit`, `minio`, `minio-init`, `web` (hosted browser SPA),
  plus the profile-gated `core-api-migrator` one-shot.

Topology overlays:

- Cloudflare Tunnel: `docker-compose.prod.tunnel.yml`
- Caddy reverse proxy: `docker-compose.prod.caddy.yml`

> **Already run a reverse proxy / `cloudflared` natively on the host?** Use
> **neither overlay** — run the base stack alone (`docker compose -f
> docker-compose.prod.base.yml up -d`) and point your existing proxy/connector
> at the host loopback ports it publishes: core-api `127.0.0.1:8787`,
> SpacetimeDB `127.0.0.1:44300`, MinIO `127.0.0.1:44390`, LiveKit signalling
> `127.0.0.1:44380` (keep `chat`/`lk` as WebSocket upgrades). The bundled
> `cloudflared` resolves Docker service names and can't share a connector with
> a host-level one, which is why a host-managed proxy skips the overlay. In
> that setup `CLOUDFLARE_TUNNEL_TOKEN` is unused.

### Tunnel track

```bash
cp .env.production.tunnel.example .env
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.tunnel.yml up -d
```

### Caddy track

```bash
cp .env.production.caddy.example .env
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml up -d
```

Validate config before start:

```bash
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.tunnel.yml config >/tmp/letschat-tunnel-config.yml
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml config >/tmp/letschat-caddy-config.yml
```

## Hosted web client (`app.<domain>`)

The `web` service builds the React/Vite bundle and serves it as static files, so
users can reach LetsChat from a browser without installing the desktop app. It is
**single-tenant**: the bundle is built with `VITE_WEB_CONNECT_URL` baked in, so a
browser hitting `app.<domain>` auto-discovers this instance via
`auth.<domain>/.well-known/letschat.json` and goes straight to login — no
setup screen. Desktop builds are unaffected (the var is unset there).

Required env (see the `.env.production.*.example` files):

- `APP_DOMAIN=app.example.com` — Caddy hostname (Caddy track only).
- `VITE_WEB_CONNECT_URL=https://auth.example.com` — baked into the bundle
  (auth.<domain> serves the discovery document).
- `VITE_WEB_WS_COMPRESSION=gzip` — DB WebSocket compression in browsers
  (`gzip` default, or `none`). The client auto-downgrades to `none` if a gzip
  socket fails to establish, so this never strands a user.
- `MINIO_CORS_ALLOW_ORIGIN=https://app.example.com` — lets the browser
  `fetch()` presigned download URLs (`*` also works).

Routing:

- **Caddy track**: handled automatically — the `{$APP_DOMAIN}` block proxies to
  `web:80`. Point `app.<domain>` DNS at the host.
- **Tunnel track**: add an ingress rule `app.<domain> -> http://web:80` in the
  Cloudflare Zero Trust dashboard (WebSocket not required — static files only).

> The bundle is built at image-build time, so **after changing
> `VITE_WEB_CONNECT_URL` you must rebuild**: `docker compose ... build web` then
> `up -d web`.

## First-time cutover from `auth-service`

Skip this section for fresh deployments.

```bash
# 1. Pull the new images (core-api, postgres, migrator) without starting yet.
docker compose -f docker-compose.prod.base.yml pull

# 2. Stop the legacy auth-service so the SQLite file is no longer being
#    written to during migration. Other services can keep serving until step 5.
docker stop letschat-auth || true

# 3. Bring postgres up so the migrator has a target.
docker compose -f docker-compose.prod.base.yml up -d postgres

# 4. Run the migrator. It mounts the legacy `auth_data` SQLite volume
#    read-only at /data/auth.db and writes Identity rows into postgres.
#    Idempotent: re-running skips users already present by username or
#    SpacetimeDB identity. Migrated accounts get an `<username>@migrated.local`
#    placeholder email; ask users to set a real one after first sign-in.
docker compose -f docker-compose.prod.base.yml \
    --profile migration run --rm core-api-migrator

# 5. Bring the rest of the stack up (core-api + overlay).
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.caddy.yml up -d

# 6. Verify before exposing publicly.
curl -fsSL http://localhost/health             # via proxy
curl -fsSL http://localhost/.well-known/letschat.json
docker compose logs core-api --tail=80

# 7. Once you're satisfied, the legacy SQLite volume is no longer needed.
#    Snapshot it first if you want a paranoid backup, then drop it.
docker volume rm letschat_auth_data
```

Rollback: redeploy the previous git tag's compose files and `pull` the
older `letschat-auth:vX.Y.Z` image. The `auth_data` volume is left intact
until step 7 specifically to make this safe.

## SpacetimeDB Publish (Production)

> **Version lockstep:** the operator's `spacetime` CLI, the `spacetimedb` npm SDK,
> the `spacetimedb` Rust crate, and the server image must all be on the **2.5.x**
> line. Upgrade the CLI with `spacetime version upgrade`. A minor-version skew
> breaks module load and the client connection.

After the stack is up, publish the module:

```bash
spacetime publish --server http://127.0.0.1:44300 letschat --module-path server --yes
```

`--yes` is safe for the **first** publish of a fresh deployment. For later
schema updates, drop `--yes` so SpacetimeDB prompts before any destructive
migration instead of wiping data.

## Promoting core-api as a SpacetimeDB admin (plan 1.5)

Some admin-panel surfaces (currently: the **Spaces → create policy** card on
`/admin/config`) push updates to the chat-domain SpacetimeDB module rather
than to the Postgres `SystemConfig` row. core-api needs a SpacetimeDB
identity that has `is_admin = true` to call those reducers.

Run this once, after the first `spacetime publish`:

```bash
# 1. Generate a long-lived token (and identity) for core-api.
spacetime token gen > core-api.token
CORE_API_IDENTITY=$(spacetime identity list | grep -A1 "$(cat core-api.token)" | tail -1 | awk '{print $1}')

# 2. As the module publisher (your operator identity — the publisher is
#    automatically the first admin via the module's `init` reducer), grant
#    core-api's identity instance-admin status:
spacetime call letschat set_user_admin "$CORE_API_IDENTITY" true

# 3. Put the token in core-api's environment and restart:
echo "SPACETIMEDB_SERVICE_TOKEN=$(cat core-api.token)" >> .env
docker compose -f docker-compose.prod.base.yml restart core-api

# 4. Verify: /admin/config now shows the Spaces card as editable; the
#    audit log records the bootstrap.
```

If you skip this, the rest of core-api works fine — only the Spaces card on
`/admin/config` renders read-only with a hint pointing back at these
instructions.

## Admin Control Panel

`core-api` serves the admin Razor area on container port `8788`. The
host mapping is **loopback-only** (`127.0.0.1:48788`), so the panel is not
reachable from the public internet even with the reverse proxy running.

Reach it from an operator workstation via SSH port-forward:

```bash
ssh -L 8788:127.0.0.1:48788 your-host
# then open http://localhost:8788/admin in a browser
```

The first time the stack starts, the bootstrap admin from
`ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` / `ADMIN_BOOTSTRAP_EMAIL`
is created automatically. Change the password as soon as you sign in and
unset those env vars on the next deploy.

## Service / Env Reference

| Area | Key env / file | Notes |
|---|---|---|
| Auth backend | `AUTH_JWT_SECRET`, `AUTH_ADMIN_API_KEY` | JWT secret required; admin API key optional (enables `/admin/accounts/rebind`) |
| PostgreSQL | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Only the password is mandatory; defaults are `letschat` / `auth` |
| Bootstrap admin | `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_EMAIL` | First-run seeding; remove from env after first sign-in |
| Registration policy | `REQUIRE_EMAIL_CONFIRMATION`, `REQUIRE_ADMIN_APPROVAL` | Booleans (`true`/`false`) — also runtime-editable via the admin panel |
| Email | `EMAIL_SENDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_USE_STARTTLS`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | `EMAIL_SENDER=smtp` for real delivery; `log` only in dev |
| Rate limiting | `RATE_LIMIT_PERMIT`, `RATE_LIMIT_WINDOW_SECONDS` | Per-IP fixed window on register/login/resend |
| Client versions | `RECOMMENDED_CLIENT_VERSION`, `MIN_CLIENT_VERSION` | Optional; default to backend's compiled version |
| LiveKit | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `livekit/config.prod.yaml` | Keys must match exactly |
| MinIO | `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_PUBLIC_ENDPOINT` | Public endpoint is used in presigned URLs |
| Discovery JSON | `DISCOVERY_SPACETIMEDB_URI`, `DISCOVERY_AUTH_URL`, `DISCOVERY_LIVEKIT_URL`, `DISCOVERY_DATABASE` | Served by core-api at `/.well-known/letschat.json` |
| Tunnel only | `CLOUDFLARE_TUNNEL_TOKEN` | Required by `cloudflared` service |
| Caddy only | `AUTH_DOMAIN`, `CHAT_DOMAIN`, `FILES_DOMAIN`, `LIVEKIT_DOMAIN`, `APP_DOMAIN` | Used by `deploy/caddy/Caddyfile` |

## Discovery Contract (`/.well-known/letschat.json`)

LetsChat setup auto-discovery expects this shape:

```json
{
  "spacetimedb": "wss://chat.example.com",
  "auth": "https://auth.example.com",
  "livekit": "wss://lk.example.com",
  "database": "letschat",
  "serverVersion": "0.3.1",
  "recommendedClient": "0.3.1",
  "minClient": "0.3.1"
}
```

`serverVersion` is the running core-api version. `recommendedClient` and
`minClient` default to the same value; operators can pin different desktop-app
versions via env (used by `/downloads/{os}` and future client-side update
gating).

LiveKit scheme by track:

- Tunnel track: `wss://lk.<domain>` — LiveKit's WebSocket **signalling** is
  tunnelled through Cloudflare (TLS terminated at the edge). The SRTP **media**
  ports (44381/44382) are not tunnelled and stay force-forwarded to the host;
  clients reach them directly via the host's public IP in the ICE candidates,
  so media does not depend on the `lk.<domain>` DNS record.
- Caddy track: `wss://lk.<domain>` — Caddy terminates TLS and proxies signalling
  to `livekit:44380`; media ports forwarded the same way.

> **Why both tracks are `wss://`.** WebRTC media is always DTLS-SRTP encrypted,
> so a passive sniffer can't reconstruct a call. But the signalling channel
> carries the SDP, ICE candidates, DTLS fingerprints, and the LiveKit join
> token in cleartext over plain `ws://` — enough for an active MITM to swap
> fingerprints and relay the media, or to replay the token. Putting signalling
> behind TLS (`wss://`) on both tracks closes that gap.

> **Media reachability (both tracks).** The media ports — `44382/udp`
> (primary) and `44381/tcp` (fallback for UDP-blocked clients) — must be
> **port-forwarded on the router to the host's LAN IP**; this is a manual step
> the tunnel does not perform.
> `use_external_ip: true` STUN-detects the public IP at container start, so a
> dynamic public IP only needs a LiveKit restart to pick up a change; signalling
> is unaffected (Caddy/tunnel-fronted). **CGNAT** (where `curl -4 ifconfig.me`
> ≠ the router's WAN IP) makes direct media impossible — those deployments need
> a TURN relay on a public-IP VPS (or Cloudflare Realtime).

Public routing:

- Tunnel track: add `auth.<domain> -> http://core-api:8787` (also serves
  `/.well-known/letschat.json`) and `lk.<domain> -> http://livekit:44380`
  (WebSocket enabled) ingress rules in Cloudflare Tunnel.
- Caddy track: `auth.<domain>` serves discovery automatically; ensure its DNS
  points to the host IP.

## Configuration lifecycle (env vs admin panel)

Two layers of config, two lifecycles:

- **Env-only** — secrets and infrastructure pointers (`AUTH_JWT_SECRET`,
  `POSTGRES_PASSWORD`, `MINIO_*`, `LIVEKIT_*`, `DISCOVERY_*`, `ADMIN_BOOTSTRAP_*`,
  `EMAIL_SENDER`, `RECOMMENDED_CLIENT_VERSION`, `MIN_CLIENT_VERSION`). Read
  once at startup. Restart-only to change.
- **First-run defaults** — operational policy (`REQUIRE_EMAIL_CONFIRMATION`,
  `REQUIRE_ADMIN_APPROVAL`, `SMTP_*`, `EMAIL_FROM_*`, `RATE_LIMIT_*`). On a
  fresh deployment these seed a row in the runtime `SystemConfig` table; from
  then on the live value comes from `/admin/config` and **the env vars are
  ignored**. The env file becomes documentation, not configuration.

Implications:

- Bootstrap: a fresh deploy can be fully configured from `.env` before the
  admin panel is ever opened.
- Live edits: post-bootstrap, change policy/SMTP/rate-limit via the admin
  panel — no restart.
- "I changed `SMTP_HOST` in `.env` and nothing happened" → expected. Edit it
  in `/admin/config`, or wipe the Postgres volume to re-seed from env.
- Rolling out a new instance from the same `.env`: env defaults apply
  cleanly because there's no row yet to override them.

## Upgrade Strategy

Routine releases do **not** have to be applied one-by-one. EF Core applies
all pending migrations on `core-api` startup in order, the SpacetimeDB module
diff is computed against whatever is currently published, and the Tauri
desktop binary is independent of both. Going from `vA` directly to `vC` runs
the same end state as `vA → vB → vC`.

Three exceptions where the order DOES matter:

1. **The legacy auth-service → core-api migrator** is the only path from a
   SQLite `auth-service` deployment to the Postgres `core-api`. It will be
   removed from CI one release after the cutover. Operators still on
   `auth-service` past that point will need to step through a release that
   still ships the migrator before jumping forward.
2. **Destructive SpacetimeDB schema changes.** `spacetime publish` prompts
   before deleting data; the prompt is the safety net. Always run publishes
   without `--yes` for upgrades (see "SpacetimeDB Publish" above) so you
   don't silently drop tables.
3. **Env var renames.** Always read the release notes for new/renamed
   variables before pulling. core-api fails fast on missing required values,
   but a renamed-but-still-set old name silently falls back to defaults.

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

- `postgres_data` volume (Identity store, system config, audit log)
- `minio_data` volume (attachments)
- `spacetimedb_home` volume (chat history)

Postgres backup example:

```bash
docker exec letschat-postgres pg_dump -U letschat auth | gzip > auth-$(date +%F).sql.gz
```
