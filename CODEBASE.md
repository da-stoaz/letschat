# LetsChat codebase map

> Architecture baseline reviewed 2026-09-15 at version 1.0.14.
>
> This document describes the current system. Security findings and feature
> gaps belong in `BUG_ANALYSIS.md`, so they cannot silently turn this map into
> another stale backlog.

## System at a glance

| Layer | Technology | Authority |
|---|---|---|
| Client | React 19, TypeScript, Vite, Tailwind CSS 4, Zustand | Presentation and local cache only |
| Desktop | Tauri 2 | Native shell and packaging |
| Control plane | .NET 10, ASP.NET Core Identity, PostgreSQL | Accounts, sessions, OIDC, administration, upload grants, LiveKit grants |
| Chat data plane | SpacetimeDB 2.10, Rust module | Chat records and authorization for every reducer call |
| Media plane | LiveKit | Ephemeral voice/video rooms |
| Object storage | MinIO/S3 | Attachment bytes; access is brokered by `core-api` |
| Archive | Rust worker | Exports configured historical data from SpacetimeDB |
| Public site | Astro | Static marketing and self-hosting documentation |

```text
React/Tauri client
  ├─ HTTPS ───────────────> core-api ─────> PostgreSQL
  │                           ├───────────> MinIO
  │                           └─ token ───> LiveKit
  └─ WebSocket + OIDC JWT ─> SpacetimeDB
                                └─ subscription updates ─> client stores

archive-worker ────────────> SpacetimeDB
```

`core-api` is the only supported identity/control-plane backend. References to
the former Rust `auth-service` describe legacy data migration, not a runtime
choice.

## Data ownership

| Data | Owner | Notes |
|---|---|---|
| Accounts, password hashes, roles, sessions, registration policy | PostgreSQL via `core-api` | ASP.NET Core Identity; Argon2id password hashes |
| OIDC signing key | Deployment secret consumed by `core-api` | Public key is published through the issuer's JWKS endpoint |
| Servers, memberships, channels, messages, social graph, presence | SpacetimeDB | Mutations happen only through Rust reducers |
| Upload metadata and daily quota | PostgreSQL via `core-api` | Pending grants reserve quota before upload confirmation |
| Attachment bytes | MinIO | Objects are private; clients receive short-lived presigned URLs |
| Voice/video state | LiveKit plus SpacetimeDB presence | LiveKit transports media; reducers model app-visible participation |

The client is never an authorization authority. UI checks improve usability;
the corresponding API action or reducer must independently authenticate and
authorize the caller.

## Repository map

```text
core-api/
  src/CoreApi/             control-plane service and Razor admin UI
  tests/CoreApi.Tests/     endpoint, service, and security regression tests
  tools/CoreApi.Migrator/  legacy SQLite-to-PostgreSQL rescue tool
server/                    SpacetimeDB schema, reducers, and Rust tests
src/
  features/                product feature UI
  generated/               generated SpacetimeDB bindings; never hand-edit
  lib/                     auth, uploads, LiveKit, Tauri, and DB integration
  stores/                  Zustand projections of server state
  test/                    frontend test support
src-tauri/                 native commands, capabilities, and packaging
archive-worker/            archive process
site/                      static Astro site
scripts/                   publishing, deployment, and security helpers
docker-compose.dev.yml     local dependencies
docker-compose.prod.base.yml
docker-compose.prod.tunnel.yml
docker-compose.prod.caddy.yml
```

## Core request flows

### Sign-in and SpacetimeDB identity

1. The client discovers the deployment through
   `/.well-known/letschat.json`.
2. `core-api` authenticates the account and returns a revocable application
   session plus a short-lived OIDC access token.
3. SpacetimeDB validates that token against the configured issuer and JWKS.
4. The module maps the trusted token subject to its `User` row. Reducers reject
   callers without the required membership, role, friendship, or ownership.

### Chat mutation and synchronization

1. The client invokes a generated reducer binding.
2. The Rust reducer validates identity and permissions, then writes atomically.
3. SpacetimeDB subscriptions deliver committed rows to the client.
4. Zustand stores project those rows for React. They are a cache, not a second
   source of truth.

Messages initially synchronize in bounded windows and older history is loaded
through explicit pagination reducers.

### Account settings

The client separates account identity, credential security, connection details,
and notification preferences into Account, Security, Connection, and
Notifications tabs. Private account metadata such as email comes from the
session-authenticated `/auth/account` endpoint; chat profile data remains owned
by SpacetimeDB. This keeps PostgreSQL account data out of public chat views.

### Attachments

1. `/uploads/request` validates and encodes the requested scope, size, MIME
   metadata, and daily quota while reserving the declared bytes in a locked
   PostgreSQL transaction. The owning chat reducer validates that scope again
   when the object is attached.
2. The client uploads directly to MinIO using signed, exact-`Content-Length`
   PUTs. Files up to the configured part size use one PUT; larger files use
   numbered S3 multipart PUTs below Cloudflare's per-request cap. Core API
   checks MinIO's part list before completing the object.
3. `/uploads/confirm` verifies the stored object, atomically converts the
   reservation into confirmed quota, and retains a confirmed-object registry
   row. The object therefore never becomes unknown after confirmation.
4. SpacetimeDB maintains normalized object references in the same transaction
   as message, DM, avatar, or space-icon changes. A fail-closed collector adopts
   legacy MinIO inventory, then an admin-only reducer atomically claims only
   unreferenced keys. Reference creation rejects claimed keys, closing the race
   between the cleanup decision and MinIO deletion. A protected claim view must
   return its authorization/readiness sentinel before Core API deletes anything.
   Failed storage deletion retains the registry row and claim for retry.
5. Download endpoints re-check channel or DM access before returning a
   short-lived URL.
6. A background sweeper aborts expired multipart sessions or removes expired
   single-PUT objects before releasing their reservations. MinIO's stale-upload
   cleanup is the fallback for an initiation crash before the upload ID is saved.

Default limits: 500 MiB per attachment, 64 MiB per multipart part, 10 MiB per
avatar/space icon, and 2 GiB of
uploads per user per UTC day. The daily
quota is an anti-abuse rate limit, not a storage quota — nothing caps the bytes
a user keeps in the bucket over time. The quota and download-resume work is specified
in `.claude/plans/object-storage.md`.

### Voice and video

`core-api` issues LiveKit grants only after checking SpacetimeDB presence and
room scope. Media then travels through LiveKit; app-visible join/leave and
control state is maintained through the SpacetimeDB module.

### Instance administration and space discovery

ASP.NET Core Identity's `Admin` role is authoritative for human instance
administrators. `AdminRoleService` mirrors each grant or revocation to the
SpacetimeDB `User.is_admin` projection; if that write fails, it rolls the Core
role back and restores the previous module value when possible. Independently,
the persisted module-owner identity is the infrastructure bootstrap admin, so
the first public registration never gains control of the instance.

Chat-domain policy stays in SpacetimeDB, where reducers can enforce it without
trusting the client. The `SystemSettings` singleton holds the space-creation
policy (`Anyone` by default or `AdminsOnly`). Discoverability is owner opt-in;
owners may set a short description and tags and may list at most ten spaces.
An `Everyone` space supports direct join, while a `ModeratorsOnly` space uses a
moderator-reviewed join request. Non-members receive only the scoped discovery
metadata and aggregate member count, not the space's membership rows.

### Archiving

The archive worker reads the module through its configured credentials and
exports only the configured retention scope. It is an operator component and
must not be exposed as a public endpoint.

## SpacetimeDB schema groups

The authoritative definitions live in `server/src/schema.rs`. Major groups are:

- configuration and ids: `SystemSettings`, `ArchiveService`, `IdCounter`
- identity and communities: `User`, `Server`, `ServerMember`, `Ban`,
  `JoinRequest`, `Invite`, `DmServerInvite`
- chat: `Channel`, `Message`, `PinnedMessage`, `DirectMessage`, `ReadState`
- social and ephemeral state: `Friend`, `Block`, `PresenceState`,
  `TypingState`
- calls: `VoiceParticipant`, `DmVoiceParticipant`

After changing the schema or reducer signatures, republish and regenerate the
TypeScript bindings:

```bash
bun run spacetime:publish
bun run spacetime:generate
```

## Runtime topology

Local development uses `docker-compose.dev.yml` for PostgreSQL, SpacetimeDB,
MinIO, and LiveKit while `core-api` and the client normally run on the host.

Production combines `docker-compose.prod.base.yml` with exactly one ingress
overlay:

- `docker-compose.prod.tunnel.yml` for Cloudflare Tunnel
- `docker-compose.prod.caddy.yml` for direct Caddy TLS

The base stack contains PostgreSQL, `core-api`, SpacetimeDB, module init, MinIO,
LiveKit, the archive worker, and the web client. The admin listener is separate
from the public API listener and is bound to loopback by the documented compose
configuration. See `DEPLOYMENT.md` for the exact ports and bootstrap procedure.

## Verification map

| Changed area | Minimum relevant checks |
|---|---|
| Frontend/client integration | `bun run build`, `bun run lint`, `bun run test:unit` |
| `core-api` | `bun run core-api:test`, `dotnet format core-api/CoreApi.slnx --verify-no-changes` |
| SpacetimeDB module | `cargo test --manifest-path server/Cargo.toml` plus regenerated bindings |
| Tauri Rust | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Security boundary | Relevant unit tests plus `bun run test:security` against its required stack |
| Compose/deployment | `docker compose ... config` for the affected base and overlay |

## Maintenance rules

- Treat generated bindings as build output; change the Rust module first.
- Keep `README.md`, this file, `SECURITY.md`, and `DEPLOYMENT.md` synchronized
  whenever a service boundary or production component changes.
- Record actionable defects and their status in `BUG_ANALYSIS.md`; link to code
  and tests instead of duplicating architectural descriptions there.
- Date scanner snapshots. Live dependency status belongs in GitHub's
  Dependabot/Security views rather than an undated count in architecture docs.
