# LetsChat Deployment Index

Full tutorial (beginner step-by-step):

- Astro page: `/self-hosting` (source: `site/src/pages/self-hosting.astro`)
- Local preview URL: `http://localhost:4321/self-hosting`

Use this file as a compact operator reference.

The deployment invariants and known residual risks are summarized in
[`SECURITY.md`](SECURITY.md). The tracked code findings live in
[`BUG_ANALYSIS.md`](BUG_ANALYSIS.md).

> **Backend service:** production runs **`core-api`** (.NET / ASP.NET Core
> Identity + PostgreSQL). The legacy Rust `auth-service` has been **removed**
> from the repo, and so has the containerised migration path that imported its
> SQLite `auth.db`. If you are still sitting on an un-migrated `auth.db`, see
> **Legacy `auth.db` import** below before bringing the stack up.

## Production Compose Entry Points

Shared core services:

- `docker-compose.prod.base.yml` — `spacetimedb`, `postgres`, `core-api`,
  `module-init`, `archive-worker`, `livekit`, `minio`, `minio-init`, `web`
  (hosted browser SPA).

Topology overlays:

- Cloudflare Tunnel: `docker-compose.prod.tunnel.yml`
- Caddy reverse proxy: `docker-compose.prod.caddy.yml`

Core API and LiveKit report Docker health status in `docker compose ps` using
HTTP probes (`/health` on port 8787 and `/` on port 44380, respectively).
Both check every 5 seconds, including during the 10-second startup grace period;
the first success marks the container healthy immediately and ends the grace
period early. Once the grace period ends, three consecutive failures mark it
unhealthy (probe runtime adds to the interval). Later successful probes restore
healthy status. `start_interval`
requires Docker Engine 25+ and Compose 2.20.2+.

These probes check API responsiveness and LiveKit node health, not dependency
health or end-to-end media delivery. Docker does not restart a container just
because it is unhealthy. Use a newly built/released Core API image with this
Compose configuration: the probe requires the included `curl` executable.

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
- `MINIO_CORS_ALLOW_ORIGIN=*` — CORS for the presigned URLs. Do **not** narrow
  this to the web origin alone; it also gates desktop uploads (see
  [Troubleshooting: file and profile-picture uploads fail silently](#troubleshooting-file-and-profile-picture-uploads-fail-silently)).

Routing:

- **Caddy track**: handled automatically — the `{$APP_DOMAIN}` block proxies to
  `web:80`. Point `app.<domain>` DNS at the host.
- **Tunnel track**: add an ingress rule `app.<domain> -> http://web:80` in the
  Cloudflare Zero Trust dashboard (WebSocket not required — static files only).

> The bundle is built at image-build time, so **after changing
> `VITE_WEB_CONNECT_URL` you must rebuild**: `docker compose ... build web` then
> `up -d web`.

## Legacy `auth.db` import

Not applicable to fresh deployments, and not applicable to any deployment
already running core-api — which is all of them. The Rust `auth-service` is
gone, and with it the `core-api-migrator` compose service, the
`letschat-core-api-migrator` image, and the `auth_data` volume.

The importer itself is still in the repo as a plain CLI tool for the one case it
still serves: an `auth.db` file rescued from an old machine.

```bash
# Copy the file off the old host first, then, against the new stack's postgres:
dotnet run --project core-api/tools/CoreApi.Migrator -- \
    --sqlite ./legacy-auth.db \
    --postgres "Host=localhost;Port=5433;Database=auth;Username=letschat;Password=..."
# --dry-run previews without writing.
```

Idempotent: re-running skips users already present by username or SpacetimeDB
identity. Argon2id hashes are copied verbatim, so migrated users keep their
passwords. Imported accounts get an `<username>@migrated.local` placeholder
email — ask those users to set a real one after their first sign-in.

If you have an old `letschat_auth_data` Docker volume still lying around, it
holds nothing but that SQLite file. Snapshot it if you're feeling paranoid,
then `docker volume rm letschat_auth_data`.

## SpacetimeDB Publish (Production)

> **Version lockstep:** the operator's `spacetime` CLI, the `spacetimedb` npm SDK,
> the `spacetimedb` Rust crate, and the server image must all be on the **2.10.x**
> line. Upgrade the CLI with `spacetime version upgrade`. A minor-version skew
> breaks module load and the client connection.

After the stack is up, publish the module:

```bash
spacetime publish --server http://127.0.0.1:44300 letschat --module-path server --yes
```

`--yes` is safe for the **first** publish of a fresh deployment. For later
schema updates, drop `--yes` so SpacetimeDB prompts before any destructive
migration instead of wiping data.

## Upgrading a running deployment

Set the release you want in `.env`, then pull and restart:

```bash
LETSCHAT_VERSION=1.0.0   # in .env
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.<track>.yml pull
docker compose -f docker-compose.prod.base.yml -f docker-compose.prod.<track>.yml up -d
```

Rolling back is the same two commands with the previous version. Every release
publishes immutable `:<version>` and `:sha-<commit>` tags, so a pinned
deployment can always go back to a known-good image.

> **⚠️ Never delete the `module_init_home` volume.** `spacetime login` mints a
> **new** identity every time it runs, and only the identity that created a
> database may update it. That volume is what keeps `module-init`'s identity
> stable across upgrades. Lose it and every subsequent publish fails with:
>
> ```
> 403 Forbidden: <identity> is not authorized to perform action on
> database <db>: update database
> ```
>
> and `restart: on-failure` turns that into a crash loop. The identity cannot be
> recovered — a non-owner cannot `publish`, `rename`, or even `delete` the
> database. Recovery means publishing under a **new** database name, pointing
> `DISCOVERY_DATABASE` / `SPACETIMEDB_MODULE_NAME` at it, and rebuilding the
> data from the cold archive (see *Cold archive*), which is one more reason to
> confirm the archive worker is actually replicating.
>
> Deployments created **before** v1.0.0 have no such volume, so their publisher
> identity was already ephemeral. Treat the first 1.0.0 upgrade of such a
> deployment as a fresh install (or plan the rename + archive-rebuild above).

## Promoting core-api as a SpacetimeDB admin (plan 1.5)

Some admin-panel surfaces (currently: the **Spaces → create policy** card on
`/admin/config`) push updates to the chat-domain SpacetimeDB module rather
than to the Postgres `SystemConfig` row. core-api needs a SpacetimeDB
identity that has `is_admin = true` to call those reducers.

Run this once, after `module-init` has published the database:

> **Where the first admin comes from.** The module's `init` reducer creates a
> reserved `@module-owner` user for the publishing identity and marks it admin.
> That identity already controls the module code, and Compose persists its CLI
> credentials in `module_init_home`. A public account is never promoted merely
> for registering first.

```bash
# 1. Read the persisted publisher identity and token from module-init's volume.
#    Use the same compose files as the running deployment.
docker compose -f docker-compose.prod.base.yml \
  -f docker-compose.prod.<track>.yml \
  run --rm module-init login show --token

# 2. Copy the reported token into .env, then recreate core-api so Compose loads it.
SPACETIMEDB_SERVICE_TOKEN=<publisher-token>
docker compose -f docker-compose.prod.base.yml \
  -f docker-compose.prod.<track>.yml \
  up -d --force-recreate core-api

# 3. Verify: core-api logs the trusted-issuer pin. After the configured human
#    bootstrap admin signs in, /admin/config shows the Spaces card as editable.
```

The module retains an explicit admin grant when the target account has not yet
created its chat-side row; `register_user` consumes that grant on first connect.
This keeps the normal sign-in-before-WebSocket ordering race-free. If you skip
the service token, admin writes remain unavailable and the trusted OIDC issuer
cannot be pinned, so do not expose a fresh deployment in that state.

## Cold archive (durability)

SpacetimeDB keeps its data in memory and has no second copy. A destructive
schema change halts `spacetime publish` on a "requires deleting data" prompt,
and the only way through is `--delete-data` — which wipes message history.

The **archive-worker** closes that hole. It subscribes to the gated `archive_*`
views and mirrors every durable row into an `archive` PostgreSQL database in
real time. With that copy in place a destructive migration becomes survivable:
drain → `--delete-data` → rebuild from Postgres.

It runs by default in the production compose. `core-api` owns the schema and
creates the `archive` database on startup; the worker only writes to it.

### One-time bootstrap — replication does not start until you do this

The `archive_*` views are gated to a registered service identity, so a fresh
worker sees nothing until an instance admin registers it.

```bash
# 1. Start the stack, then read the identity the worker was issued.
docker compose -f docker-compose.prod.base.yml logs archive-worker | grep "identity"

# It logs the exact command to run, e.g.:
#   Archive worker identity: c200a1f...
#   If the archive views are empty, register this identity once (as an instance
#   admin): spacetime call letschat set_archive_service_identity '["0xc200a1f..."]'

# 2. Register it. The reducer is admin-gated, and note the REQUIRED 0x prefix
#    (without it: "invalid digit found in string").
spacetime call letschat set_archive_service_identity '["0x<identity-from-logs>"]'

# 3. Verify rows are flowing.
docker compose -f docker-compose.prod.base.yml logs archive-worker | tail -20
#   expect: "Subscription applied; reconciling archive."
docker compose -f docker-compose.prod.base.yml exec postgres \
  psql -U letschat -d archive -c 'SELECT count(*) FROM archive_message;'
```

If step 2 fails with **HTTP 530**, your `spacetime` CLI identity is not an
instance admin. Since core-api became the OIDC issuer, admin status lives on
identities *derived from core-api accounts* — the raw CLI/publisher identity
generally is **not** one of them. Write the row directly as the module owner
instead:

```bash
# On a fresh instance there is no row yet — `init` does not seed one, the reducer
# inserts it on first call — so an UPDATE would match zero rows and report
# success while changing nothing. INSERT the singleton (id is fixed at 1):
spacetime sql letschat \
  "INSERT INTO archive_service (id, service_identity) VALUES (1, 0x<identity-from-logs>)"

# Re-pointing an ALREADY registered worker (e.g. after its volume was recreated)
# is the UPDATE instead:
spacetime sql letschat \
  "UPDATE archive_service SET service_identity = 0x<identity-from-logs> WHERE id = 1"
```

Check which one you need with
`spacetime sql letschat "SELECT * FROM archive_service"` — no rows means INSERT.

If you have no `spacetime` CLI on the host, run it through the module image using
the publisher identity that compose already persists:

```bash
docker run --rm --network letschat_default \
  -v letschat_module_init_home:/home/spacetime \
  ghcr.io/da-stoaz/letschat-module:${LETSCHAT_VERSION} \
  sql -s http://spacetimedb:3000 letschat "SELECT * FROM archive_service"
```

The identity is persisted to the `archive_worker_data` volume so it survives
restarts. **Deleting that volume issues a new identity**, and replication stops
until you re-register it — the reducer is idempotent, so re-running step 2 with
the new identity is all that's needed.

An unregistered worker is safe: it refuses to reconcile rather than mistaking
empty gated views for an emptied database (which would delete the archive). It
logs `Refusing to reconcile: every archive_* view returned 0 rows` until you
register it.

### Rebuilding SpacetimeDB from the archive

After a destructive migration, restore the durable tables from Postgres by
running the worker once in rebuild mode:

```bash
docker compose -f docker-compose.prod.base.yml run --rm \
  -e ARCHIVE_REBUILD=1 archive-worker
```

It reloads every durable table verbatim (explicit primary keys and timestamps)
and exits. Take a Postgres backup first — this is the copy you are restoring
from, and it is the only one.

Attachment cleanup is paused from the moment `--delete-data` runs: the module's
`init` fences the storage collector so it cannot mistake the empty tables for
unreferenced files. The first restore batch turns that into a normal 10-minute
quiet period, after which cleanup resumes on its own. If you wiped the database
deliberately and are **not** restoring, lift the fence as an instance admin once
you have accepted that old attachments become collectable:

```bash
spacetime call letschat release_storage_init_fence '{"none":[]}'
```

A brand-new instance needs nothing: core-api lifts the fence itself, because none
of its stored files predates the database. After a wipe under existing files the
module refuses that automatic release until the restore runs.

Rebuild reducers raise the module-managed `IdCounter` values past every restored
auto-increment id, so new rows cannot collide with restored rows. Instances
rebuilt before those counters existed can repair them idempotently with
`archive_reseed_id_counters`. Still verify a test message and DM after a rebuild
before ending maintenance mode.

### Disabling it

Unset `ARCHIVE_DATABASE_URL` on `core-api` and remove the `archive-worker`
service. You then have no second copy of message history.

## SpacetimeDB identity — the issuer is permanent

core-api is the OIDC issuer for SpacetimeDB: it signs each user's SpacetimeDB
access token, and SpacetimeDB verifies that signature by fetching
`{SPACETIME_OIDC_ISSUER}/.well-known/openid-configuration` and the JWKS behind
it. Two consequences worth understanding before you operate this:

1. **That fetch is made by the SpacetimeDB container**, not by any client. The
   issuer is therefore pinned in compose to the internal service address
   `http://core-api:8787`, which is reachable on the Docker network in both
   topologies. A public `https://auth.<domain>` URL is deliberately *not* used:
   the container would have to leave the host and come back (unreliable behind
   NAT, and not routable at all on the tunnel setup).

2. **The issuer string is hashed into every account's identity**
   (`blake3(issuer + "|" + account id)`). This is what makes identities
   deterministic and survive a SpacetimeDB data wipe — but it also means
   changing the issuer re-derives every identity and orphans every account from
   its spaces and messages. **Never edit `SPACETIME_OIDC_ISSUER` after the first
   user registers.** It is set in compose rather than `.env` for that reason.

`SPACETIME_OIDC_PRIVATE_KEY` is the separate signing key (base64-encoded PEM,
see the `.env.production.*.example` files). Rotating it invalidates access
tokens already issued — everyone signs in again — but leaves accounts,
identities and data untouched.

**If you rotate it, restart the `spacetimedb` container too.** SpacetimeDB
caches the issuer's JWKS and does not re-fetch when it meets an unknown key id,
so until it restarts every token signed by the new key is rejected with
`401 Specified key ID not found in JWKs`. Client-visible symptom: voice fails
with "You are not a participant in this voice room", because the room
authorization query fails closed.

Upgrading an instance that predates this: core-api migrates identities
automatically on first start, re-keying SpacetimeDB's rows and its own records
in one pass. No manual steps, no wipe. If SpacetimeDB is unreachable at that
moment the migration is deferred and retried on the next start.

## Who may create a chat account

SpacetimeDB hands an identity to anyone who asks — `POST /v1/identity` is
unauthenticated — and `chat.<domain>` is public, so the module cannot assume the
caller came through core-api. Two checks in the module close that door:

- Every client-callable reducer requires the caller to have a `User` row, i.e. a
  registered account on this instance.
- `register_user`, the only reducer that creates one, requires the caller's
  token to carry the `iss` claim of this instance's OIDC issuer — which only
  core-api can sign for. That is what makes `REGISTRATION_OPEN`,
  `REQUIRE_EMAIL_CONFIRMATION` and `REQUIRE_ADMIN_APPROVAL` binding on the chat
  side and not just on the HTTP API.

core-api pushes its own `SPACETIME_OIDC_ISSUER` into the module with the
`set_trusted_issuer` reducer, at startup and again whenever an administrator
signs in. Two things follow:

1. **The pin uses the module-owner credential.** Configure
   `SPACETIMEDB_SERVICE_TOKEN` from `module_init_home` as described above before
   exposing a fresh deployment. No public user participates in this bootstrap.

2. **Until it is pinned, the check is off, not on.** An unpinned instance
   behaves exactly as it did before, so publishing a new module to a running
   deployment can never lock out its users.

Confirm it took, as an instance admin:

```
spacetime sql -s <server> <database> "SELECT trusted_issuer FROM system_settings"
```

An empty result means the owner credential was absent or the module was
unreachable when core-api last tried. Fix that configuration and restart;
core-api logs `Pinned SpacetimeDB trusted issuer to …` when it succeeds.

## Ending a session: disables and password resets

The chat client talks to SpacetimeDB directly, so core-api's account checks are
not on that path. Two things follow, and both are now enforced in the module
rather than left to token expiry:

- **Disabling an account in the control panel takes effect immediately.** It
  used to only block the next sign-in; the account kept reading and posting
  until its SpacetimeDB token expired, which could be up to 30 days.
- **A password reset or change ends every other session.** Each account carries
  a token generation that increments on any credential change; core-api stamps
  it into every token it mints and pushes the new floor to the module, which
  refuses anything older on its next reducer call. The device that performed the
  change is handed a replacement, so it stays signed in.

**You do not configure this.** The push happens automatically and needs an
instance admin to exist (the same credential the admin panel already uses).

**It fails open, deliberately.** If SpacetimeDB is unreachable when an account is
disabled or a password reset, the change is still saved in core-api — only the
push is lost, and the module keeps admitting the old tokens until the next push
succeeds. The alternative would be locking legitimate users out of chat because
the database blinked. core-api logs the failure:

```
Could not push access state for <user> to SpacetimeDB.
```

If you see it, the account's core-api side is correct but its chat sessions are
not yet revoked. Any later status change or credential change re-pushes; to
force it, toggle the account's status in the control panel once SpacetimeDB is
back.

To confirm the module's view of an account:

```
spacetime sql -s <server> <database> \
  "SELECT username, suspended, min_token_generation FROM user WHERE username = '<name>'"
```

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

The separate SpacetimeDB module owner is seeded during publish and is the only
initial chat-domain admin. Normal registrations are never promoted implicitly;
core-api forwards the configured human administrator's explicit role through
the owner credential.

## Service / Env Reference

| Area | Key env / file | Notes |
|---|---|---|
| Auth backend | `AUTH_JWT_SECRET` | Required. Signs the client session tokens (HS256) |
| SpacetimeDB HTTP | `SPACETIMEDB_HTTP_URL`, `SPACETIMEDB_MODULE_NAME` | Where core-api reaches the module for reducer and `/sql` calls. Wired in compose to `http://spacetimedb:3000`; the code default (`localhost:4300`) is for host-run dev only and is wrong inside a container. See "Voice fails" below |
| SpacetimeDB identity | `SPACETIME_OIDC_PRIVATE_KEY` | **Required.** Signs the SpacetimeDB access token (RS256); supply a base64-encoded PEM. Generate once — replacing it forces every user to sign in again. `SPACETIME_OIDC_ISSUER` is fixed in compose and must never change (see below) |
| PostgreSQL | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Only the password is mandatory; defaults are `letschat` / `auth` |
| Cold archive | `ARCHIVE_DB` | Database name for the durable mirror, default `archive` (same Postgres instance as auth). Wired in compose for both `core-api` and `archive-worker`; needs a one-time identity registration — see "Cold archive" above |
| Bootstrap admin | `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_EMAIL` | First-run seeding; remove from env after first sign-in |
| Registration policy | `REQUIRE_EMAIL_CONFIRMATION`, `REQUIRE_ADMIN_APPROVAL` | Booleans (`true`/`false`) — also runtime-editable via the admin panel |
| Email | `EMAIL_SENDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_USE_STARTTLS`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | `EMAIL_SENDER=smtp` for real delivery; `log` only in dev |
| Rate limiting | `RATE_LIMIT_PERMIT`, `RATE_LIMIT_WINDOW_SECONDS` | Per-IP fixed window, separate budgets for registration, email, and password actions; sign-in allows 10× |
| Client versions | `RECOMMENDED_CLIENT_VERSION`, `MIN_CLIENT_VERSION` | Optional; default to backend's compiled version |
| LiveKit | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `livekit/config.prod.yaml` | Keys must match exactly |
| MinIO | `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_PUBLIC_ENDPOINT` | Public endpoint is baked into every presigned upload/download URL — it must be the address **clients** use (`https://files.<domain>`), not the internal one. Left unset it silently falls back to `MINIO_INTERNAL_ENDPOINT`, so core-api refuses to start in Production rather than hand every client a URL it cannot reach |
| MinIO CORS | `MINIO_CORS_ALLOW_ORIGIN` | Keep `*`. Gates the presigned **upload** PUT as well as downloads, and the desktop app's origin is `tauri://localhost` / `http://tauri.localhost` — pinning to `https://app.<domain>` alone silently blocks every desktop upload at the CORS preflight |
| Discovery JSON | `DISCOVERY_SPACETIMEDB_URI`, `DISCOVERY_AUTH_URL`, `DISCOVERY_LIVEKIT_URL`, `DISCOVERY_DATABASE` | Served by core-api at `/.well-known/letschat.json`. The three URLs are handed to clients verbatim; they default to `localhost`, so core-api refuses to start in Production if any is left on a loopback address |
| Tunnel only | `CLOUDFLARE_TUNNEL_TOKEN` | Required by `cloudflared` service |
| Service domains | `AUTH_DOMAIN`, `CHAT_DOMAIN`, `FILES_DOMAIN`, `LIVEKIT_DOMAIN`, `APP_DOMAIN` | Used by `deploy/caddy/Caddyfile` (Caddy track) **and by the `web` container on both tracks** — `deploy/web/Caddyfile` builds the browser client's Content-Security-Policy from them. Left unset on the tunnel track the CSP is emitted with empty hosts; it is report-only, so nothing breaks, but the policy protects nothing |

## Upload limits and multipart transfers

Files up to the configured part size are uploaded in one presigned PUT straight
to MinIO. Larger files use S3 multipart: each numbered PUT carries one part,
and core-api checks all sizes before asking MinIO to assemble the object.
Interrupted uploads can retry completed parts within the live two-hour session;
cross-restart resume and download resume are not implemented. Core API enforces:

| Limit | Value | Where |
|-------|-------|-------|
| Per file | 500 MiB initially | `UPLOAD_MAX_FILE_SIZE_MIB`, then `/admin/config` |
| Multipart part | 64 MiB initially | `UPLOAD_PART_SIZE_MIB`, then `/admin/config` (5–90 MiB) |
| Avatar / space icon | 10 MiB and `image/*` | enforced by core-api and mirrored in the client pickers |
| Per-user upload rate | 2 GiB per UTC day initially | `DAILY_UPLOAD_QUOTA_MIB`, then `/admin/config`; charged bytes plus today's pending reservations |
| Stored bytes per user | unlimited initially (`0`) | `USER_STORAGE_LIMIT_MIB`, then `/admin/config`; confirmed objects plus all pending reservations |
| Stored bytes per installation | unlimited initially (`0`) | `INSTANCE_STORAGE_LIMIT_MIB`, then `/admin/config`; all confirmed objects plus all pending reservations in this bucket |

The five upload/quota `.env` values seed the PostgreSQL `SystemConfig` fields
once. Later changes in `/admin/config` take effect for new requests immediately;
editing `.env` again does not overwrite them. Existing sessions retain their
original reservation and part size. The API publishes the effective limits in
discovery; authenticated users can read current personal usage at
`POST /uploads/quota`. The admin page shows tracked installation usage. Stored
quota changes never delete existing files; a lower limit blocks new requests
until enough tracked objects are removed. Registry rows remain charged until
MinIO deletion succeeds. At startup, quota-limited upload requests wait for a
complete bucket inventory; a failed inventory returns a retryable error, not an
undercounted allowance. Raising the file maximum above 500 MiB is possible
(up to the separate 2 GiB per-file cap),
but browser downloads still buffer the whole file in RAM until download
streaming/resume is implemented.

An unlimited installation quota does **not** guarantee free disk on the MinIO
volume: MinIO metadata, incomplete multipart uploads, other buckets, and other
services also use space. If MinIO reports `XMinioStorageFull` / HTTP 507, the
client shows an explicit storage-full error and never confirms the file. Failed
single-PUT reservations are aborted best-effort; tracked failures are retried
by the sweeper. Multipart sessions remain retryable until cancelled or expired.

What the proxy adds on top:

- **Caddy track** — `deploy/caddy/Caddyfile` sets no `request_body max_size`;
  the configured app limit applies.
- **Tunnel track** — Cloudflare caps each request body at **100 MB on Free and
  Pro**. The default 64 MiB multipart parts stay below that cap, so a larger
  file can pass as several requests. A part size above 90 MiB is rejected by
  core-api configuration validation. **Downloads are not affected** by the
  request-body cap. Old clients without multipart support keep using one PUT;
  behind a tunnel those requests still fail above Cloudflare's body cap.

Confirmed objects are retained in PostgreSQL and referenced atomically by the
SpacetimeDB rows that use them. The lifecycle collector waits one hour, rebuilds
the reference table after upgrades/restores, and adopts pre-existing `uploads/`
objects from MinIO. An admin-only reducer then atomically creates permanent
deletion claims only for keys that have no reference; every reference-writing
reducer rejects claimed keys. Core API deletes only claims returned by the
protected view together with its authorization/readiness sentinel. If
SpacetimeDB, MinIO, or the admin credential is unavailable, cleanup stops and
retains the registry row for retry. `SPACETIMEDB_SERVICE_TOKEN` or a synchronized
chat-domain admin is therefore required for cleanup, but an outage cannot make
the collector guess and delete live data.

Video posters are rendered by core-api in the background (`VideoThumbnailWorker`):
one job at a time, below-normal priority, 60 s timeout, three attempts. ffmpeg
reads the video through range requests (index plus a few frames, never the whole
file) and stores `{videoKey}.thumb.jpg` next to it, which inherits the video's
read rule and is deleted with it. The core-api image ships ffmpeg; outside the
image set `FFMPEG_PATH` or install it on `PATH`. Without ffmpeg the worker logs a
warning and videos show a play placeholder; jobs stay pending until it is available.

Stop Core API during any destructive SpacetimeDB reset. Restore the chat-domain
data and run the reference rebuild before starting it again; this prevents an
in-flight deletion claim from outliving the SpacetimeDB tombstone table.

## Troubleshooting: file and profile-picture uploads fail silently

**Symptom:** in production a profile picture or chat attachment never uploads.
The picker opens, the spinner runs, and either nothing changes or you get a bare
"network error" — while the same build works fine against local dev services.

**Cause:** `MINIO_CORS_ALLOW_ORIGIN` pinned to the hosted web origin only
(`https://app.<domain>`). Uploads are a browser-issued `PUT` straight to
`files.<domain>` with a presigned URL, and `Content-Type: image/png` is not a
CORS-safelisted value — so every upload is preceded by a preflight `OPTIONS`.
MinIO answers that preflight with `Access-Control-Allow-Origin` only for the
origins on this list, and **the desktop app is not on it**: the Tauri webview
enforces CORS like any browser and its page origin is `tauri://localhost`
(macOS/Linux) or `http://tauri.localhost` (Windows). Dev never shows this
because the dev MinIO runs with MinIO's default of `*`.

**Fix:** set `MINIO_CORS_ALLOW_ORIGIN=*` and `docker compose ... up -d minio`.
The presigned URL's SigV4 signature — not the `Origin` header — is what
authorises the request, so `*` gives up no access control. If you must pin it,
list every client origin:

```
MINIO_CORS_ALLOW_ORIGIN=https://app.example.com,tauri://localhost,http://tauri.localhost
```

**Confirm:** the preflight should echo your origin back.

```bash
curl -i -X OPTIONS https://files.example.com/letschat-files/probe   -H "Origin: tauri://localhost"   -H "Access-Control-Request-Method: PUT"   -H "Access-Control-Request-Headers: content-type"
# expect: 200 + access-control-allow-origin. No such header = uploads are blocked.
```

## Troubleshooting: voice fails with "You are not a participant"

`/livekit/token` authorizes a room by reading the caller's voice-presence row
out of the module over `/sql`. If core-api cannot reach SpacetimeDB, that read
cannot happen — and before v1.0.5 the failure was reported to the user as a
permission denial, which is the wrong place to go looking.

Since v1.0.5 the two are distinguished:

- **`403` "You are not a participant in this voice room."** — the module
  answered and you hold no presence row. A real authorization decision.
- **`503` "Voice is temporarily unavailable…"** — the module never answered.
  An outage or a misconfiguration, and worth retrying.

For the `503`, check core-api's log for the line naming the address it tried:

```bash
docker compose -f docker-compose.prod.base.yml logs core-api | grep -i "CANNOT REACH\|Voice presence"
```

core-api probes SpacetimeDB once at startup and logs at `Error` if it is
unreachable, naming the configured URL. The usual cause is
`SPACETIMEDB_HTTP_URL` missing or pointing at `localhost` — inside a container
that resolves to core-api itself, not to the database. Compose sets it to
`http://spacetimedb:3000`; a deployment whose compose file predates v1.0.5 does
not set it at all, and should be updated (or the variable added by hand).

Same root cause, other symptoms: `trusted_issuer` stays empty, instance-admin
changes never reach the module, and the OIDC identity migration defers forever.

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

Two exceptions where the order DOES matter:

1. **Destructive SpacetimeDB schema changes.** `spacetime publish` prompts
   before deleting data; the prompt is the safety net. Always run publishes
   without `--yes` for upgrades (see "SpacetimeDB Publish" above) so you
   don't silently drop tables.
2. **Env var renames.** Always read the release notes for new/renamed
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
