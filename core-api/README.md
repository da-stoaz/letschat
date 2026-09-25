# core-api

`core-api` is LetsChat's production identity and control-plane service. It runs
on .NET 10 with ASP.NET Core Identity and PostgreSQL; the former Rust
`auth-service` has been removed from the runtime architecture.

## Responsibilities

| Area | Routes or interface |
|---|---|
| Accounts | register, link, login, verify, account, password change/reset, email confirmation, session renewal |
| OIDC | discovery metadata and JWKS used by SpacetimeDB |
| Voice | `POST /livekit/token` |
| Attachments | `POST /uploads/request`, `/confirm`, `/download-url`, `/download-urls` |
| Administration | Razor UI under `/admin` on a separate listener |
| Client discovery | `GET /.well-known/letschat.json` |
| Releases and health | `GET /downloads/{os}`, `GET /health` |

Accounts extend Identity's `ApplicationUser` with display name, normalized
SpacetimeDB identity, account status, and a token generation. Passwords use
Argon2id PHC strings. Application sessions use signed one-hour access and
seven-day refresh tokens; the separate asymmetric OIDC token is what
SpacetimeDB validates.

The service also synchronizes account access state and selected instance
settings into the SpacetimeDB module. Chat messages, memberships, and reducer
authorization remain owned by `server/`, not this service.

See the repository [`SECURITY.md`](../SECURITY.md) for the required trust
boundaries and [`CODEBASE.md`](../CODEBASE.md) for end-to-end flows.

## Project layout

```text
core-api/
  src/CoreApi/
    Data/                  Identity, upload, configuration, audit, and archive persistence
    Endpoints/             public HTTP endpoint groups
    Identity/              Argon2id integration
    Pages/Admin/           Razor administration UI
    Services/              tokens, SpacetimeDB, storage, email, config, audit
  tests/CoreApi.Tests/     unit and in-process integration tests
  tools/CoreApi.Migrator/  legacy SQLite rescue/import CLI
```

## Local development

From the repository root:

```bash
bun run services:up
bun run core-api:dev
```

Development configuration comes from
`src/CoreApi/appsettings.Development.json`. The public API listens on
`0.0.0.0:8787` (the SpacetimeDB container must reach its OIDC metadata) and the
admin UI on `127.0.0.1:8788`. Root `.env` files are not read: that file holds
production-stack settings for `docker compose`. EF Core migrations for
the configured databases run on startup.

Run checks with:

```bash
bun run core-api:test
dotnet format core-api/CoreApi.slnx --verify-no-changes
dotnet ef migrations has-pending-model-changes \
  --project core-api/src/CoreApi/CoreApi.csproj
```

Create and apply a migration with:

```bash
export AUTH_DATABASE_URL="Host=localhost;Port=5433;Database=auth;Username=letschat;Password=letschat"
dotnet ef migrations add <Name> \
  --project core-api/src/CoreApi/CoreApi.csproj \
  --output-dir Data/Migrations
dotnet ef database update --project core-api/src/CoreApi/CoreApi.csproj
```

## Configuration

Production values are supplied through environment variables. The most
important groups are:

| Variables | Purpose |
|---|---|
| `AUTH_DATABASE_URL`, `ARCHIVE_DATABASE_URL` | PostgreSQL connections |
| `AUTH_BIND`, `ADMIN_BIND` | public and private listener addresses |
| `AUTH_JWT_SECRET` | application-session HS256 signing secret |
| `SPACETIME_OIDC_ISSUER`, `SPACETIME_OIDC_PRIVATE_KEY` | issuer identity and persistent asymmetric signing key |
| `SPACETIME_*` | module URL, database name, and service credentials |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` | object storage credentials and bucket |
| `MINIO_INTERNAL_ENDPOINT`, `MINIO_PUBLIC_ENDPOINT` | server-side and client-visible S3 endpoints |
| `UPLOAD_PART_SIZE_MIB`, `UPLOAD_MAX_FILE_SIZE_MIB` | initial upload limits; later editable in `/admin/config` |
| `DAILY_UPLOAD_QUOTA_MIB`, `USER_STORAGE_LIMIT_MIB`, `INSTANCE_STORAGE_LIMIT_MIB` | initial daily and retained-byte limits; stored limits use `0` for unlimited and all three are later editable in `/admin/config` |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | media server and grant signing |
| `DISCOVERY_*` | values returned to clients by discovery |
| `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_EMAIL` | optional first-run administrator |
| `EMAIL_SENDER`, `SMTP_*` | verification and password-reset delivery |

The canonical production list and generated-secret procedure are in
[`DEPLOYMENT.md`](../DEPLOYMENT.md). Outside Development, the process refuses to
start with known public development secrets or endpoints.

## Attachment guarantees

Clients upload bytes directly to MinIO as one signed PUT up to the configured
part size or as numbered S3 multipart PUTs above it. `core-api` reserves the
declared size against the user's daily quota before returning presigned URLs,
signs each PUT's exact `Content-Length`, verifies the resulting object on
confirmation, and checks chat
scope again before minting a download URL. Expired unconfirmed objects are
removed by `PendingUploadSweeper`; their quota stays reserved when storage
deletion fails so a storage outage cannot reopen the quota.

Confirmation promotes the pending row into a durable object registry.
SpacetimeDB updates normalized references atomically with messages, DMs,
avatars, and space icons. The collector rebuilds those derived references,
adopts older MinIO objects, waits one hour, and asks an admin-only reducer to
atomically claim keys that are still unreferenced. Reference writers reject
claimed keys, so a key cannot become live between that decision and deletion.
Core API trusts only claims returned with the protected view's
authorization/readiness sentinel. Missing authorization or an unavailable
dependency fails closed: the object and registry row remain for retry.

Confirmed videos get a poster job. `VideoThumbnailWorker` runs one ffmpeg job at
a time at below-normal priority and writes `{videoKey}.thumb.jpg`, which shares
the video's read rule and is removed with it. Local development needs ffmpeg on
`PATH` (or `FFMPEG_PATH`); without it thumbnails stay pending.

Initial limits are 500 MiB per attachment and 64 MiB per multipart part;
the five upload/quota `.env` values seed runtime-editable values in
`/admin/config`. Avatars/icons remain limited to 10 MiB and `image/*`.
The daily upload-rate limit starts at 2 GiB per user; stored-byte limits per
user and per installation default to unlimited (`0`). Confirmed registry bytes
and all pending reservations count until storage deletion succeeds; a full
MinIO volume reports a separate storage-full error even when the configured
instance limit is unlimited. Authenticated clients can read personal usage via
`POST /uploads/quota`. Single PUT has a 10-minute URL and 15-minute
confirmation window; multipart sessions last two hours and part URLs at most
10 minutes. Download URLs last one hour, with at most 128 keys per download
batch. Behind a Cloudflare Tunnel, multipart parts
remain below the 100 MB Free/Pro request-body cap; see `DEPLOYMENT.md`.

## Legacy account import

`CoreApi.Migrator` exists only for an `auth.db` recovered from a deployment that
predates the completed cutover. It copies compatible Argon2id hashes so users
retain their passwords, skips existing accounts, and supports `--dry-run`.

```bash
dotnet run --project core-api/tools/CoreApi.Migrator -- \
  --sqlite ./legacy-auth.db \
  --postgres "Host=localhost;Port=5433;Database=auth;Username=letschat;Password=..." \
  --dry-run
```

## Container image

```bash
docker build -t letschat-core-api core-api
```

Production deployment combines `docker-compose.prod.base.yml` with one ingress
overlay. The admin port must remain loopback-only.
