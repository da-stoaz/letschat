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
`127.0.0.1:8787` and the admin UI on `127.0.0.1:8788`. EF Core migrations for
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
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | media server and grant signing |
| `DISCOVERY_*` | values returned to clients by discovery |
| `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_EMAIL` | optional first-run administrator |
| `EMAIL_SENDER`, `SMTP_*` | verification and password-reset delivery |

The canonical production list and generated-secret procedure are in
[`DEPLOYMENT.md`](../DEPLOYMENT.md). Outside Development, the process refuses to
start with known public development secrets or endpoints.

## Attachment guarantees

Clients upload bytes directly to MinIO as one `PUT` per file — there is no
multipart/chunked upload. `core-api` reserves the declared size against the
user's daily quota before returning a presigned PUT, signs the exact
`Content-Length`, verifies the resulting object on confirmation, and checks chat
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

Limits are 500 MiB per attachment, 10 MiB and `image/*` for avatars/icons,
2 GiB per user per UTC day, 10 minutes for the PUT URL, 15 minutes to confirm,
one hour for a download URL, and 128 keys per download batch. The daily quota
only bounds the upload rate; there is no cap on
the total bytes a user has stored. Behind a Cloudflare Tunnel the effective
per-file limit is Cloudflare's request-body cap (100 MB on Free/Pro), see
`DEPLOYMENT.md`.

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
