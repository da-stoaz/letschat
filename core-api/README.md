# core-api

The LetsChat **core-api** service — the .NET / ASP.NET Core rebuild of the
former Rust `auth-service`, on **ASP.NET Core Identity** + **PostgreSQL**.

This is **Phase 1** of `.claude/plans/1-control-panel.md`: the service rebuild
and data migration. Email verification, rate limiting, the approval workflow,
and the admin control panel are later phases.

## What it does

Re-implements every integration point of the legacy service, with the HTTP/JSON
contract unchanged so the existing Tauri desktop client works without changes:

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/link`, `/auth/login`, `/auth/verify`, `/auth/renew-session`, `/auth/refresh-spacetime-token` |
| Voice | `POST /livekit/token` |
| Files | `POST /uploads/request`, `/uploads/confirm`, `/uploads/download-url`, `/uploads/download-urls` |
| Admin | `POST /admin/accounts/rebind` |
| Misc | `GET /health`, `GET /.well-known/letschat.json` |

- **Identity** — accounts live in ASP.NET Core Identity (`AspNetUsers`, …),
  extended with the chat binding: `DisplayName`, `SpacetimeIdentity`,
  `SpacetimeIdentityNorm` (unique-indexed — one account ↔ one SpacetimeDB
  identity), `SpacetimeToken`, and an `AccountStatus`.
- **Passwords** — hashed with **Argon2id** in PHC format (`Argon2Phc`). This
  matches the format the legacy Rust service produced, so migrated hashes
  verify unchanged. See `Identity/Argon2Phc.cs`.
- **Sessions** — `TokenService` issues the `SessionToken` the client
  round-trips; the `access_token` is a self-contained HS256 JWT.

## Project layout

```
core-api/
  src/CoreApi/          the service
  tests/CoreApi.Tests/  xUnit tests (Argon2 hasher, token service)
  tools/CoreApi.Migrator/  one-time SQLite → PostgreSQL data migration
```

## Local development

PostgreSQL runs as part of the dev stack (`docker-compose.dev.yml`, host port
**5433**). MinIO / LiveKit are the same containers the chat app uses.

```bash
# from the repo root
bun run services:up        # starts postgres, minio, livekit, spacetimedb
bun run core-api:dev       # runs core-api on 127.0.0.1:8787
```

`core-api:dev` runs with `ASPNETCORE_ENVIRONMENT=Development`, which loads
`src/CoreApi/appsettings.Development.json` (connection string, discovery URLs).
EF Core migrations are applied automatically on startup.

### Tests

```bash
dotnet test core-api/CoreApi.slnx
```

### EF Core migrations

```bash
export AUTH_DATABASE_URL="Host=localhost;Port=5433;Database=auth;Username=letschat;Password=letschat"
dotnet ef migrations add <Name> --project core-api/src/CoreApi/CoreApi.csproj --output-dir Data/Migrations
dotnet ef database update --project core-api/src/CoreApi/CoreApi.csproj
```

## Data migration from the legacy service

`CoreApi.Migrator` reads the legacy SQLite `accounts` table and writes Identity
users into PostgreSQL. Argon2id hashes are copied verbatim — migrated users
keep their passwords. The run is idempotent (existing username/identity skipped).

```bash
dotnet run --project core-api/tools/CoreApi.Migrator -- \
  --sqlite auth-service/auth.db \
  --postgres "Host=localhost;Port=5433;Database=auth;Username=letschat;Password=letschat"
# add --dry-run to preview without writing
```

## Configuration

Values are read from environment variables (same names the legacy service used)
or, in Development, from `appsettings.Development.json`.

| Variable | Purpose | Dev default |
|---|---|---|
| `AUTH_DATABASE_URL` | PostgreSQL connection string | `…Port=5432;Database=auth…` |
| `AUTH_BIND` | listen address | `127.0.0.1:8787` |
| `AUTH_JWT_SECRET` | HS256 signing secret for sessions | dev placeholder |
| `AUTH_ADMIN_API_KEY` | enables `POST /admin/accounts/rebind` | unset (disabled) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET` | object storage | `minioadmin` / `minioadmin` / `letschat-files` |
| `MINIO_INTERNAL_ENDPOINT` / `MINIO_PUBLIC_ENDPOINT` | S3 endpoints (HEAD vs. presign) | `http://127.0.0.1:4390` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit token signing | `devkey` / dev secret |
| `DISCOVERY_*` | values served at `/.well-known/letschat.json` | localhost URLs |
| `ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` | optional: seed an `Admin`-role user on startup | unset |

## Docker

```bash
docker build -t letschat-core-api core-api
```

## Production cutover (not yet done — kept for the deployment flip)

The legacy `auth-service/` is intentionally left in place as a fallback. To cut
over: point the production compose files / reverse proxy at the core-api image
instead of `auth-service`, stand up the PostgreSQL `auth` database, run the
migrator once, then retire `auth-service/`.
