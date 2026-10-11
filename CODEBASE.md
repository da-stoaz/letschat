# LetsChat codebase map

> Architecture baseline reviewed 2026-09-15 at version 1.0.14.
>
> This document describes the current system. Security findings and feature
> gaps belong in [`Findings/BUG_ANALYSIS.md`](Findings/BUG_ANALYSIS.md), so they
> cannot silently turn this map into another stale backlog.

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

## Trust boundaries

> Security baseline reviewed 2026-09-18 at version 1.0.18; consolidated here
> on 2026-10-11.

### The client is untrusted

React, Tauri, and generated SpacetimeDB bindings may hide unavailable actions,
but client-side checks never grant access. Every `core-api` endpoint and every
Rust reducer must authenticate and authorize the caller independently.

Do not accept a username, SpacetimeDB identity, server id, room name, storage
key, role, or claimed file metadata merely because the client supplied it.

Application and SpacetimeDB tokens are currently persisted in webview
`localStorage`, including desktop builds; they are not protected by an OS
keychain. Preventing script injection therefore matters directly to credential
protection: the hosted web client ships an enforced CSP (no `'unsafe-inline'`
scripts, `connect-src` limited to the instance's own services).

### `core-api` is the identity authority

- Accounts and roles use ASP.NET Core Identity backed by PostgreSQL.
- Passwords are Argon2id hashes and inputs are limited to 8–128 characters.
- Five failed sign-in attempts lock an account for five minutes.
- The public JSON API has a 256 KiB request-body limit. Files never transit it.
- Abuse-prone auth endpoints use IP-partitioned fixed-window rate limiters,
  one budget each for registration, email actions, and password actions, so
  flooding one flow cannot lock another. Sign-in gets ten times the budget,
  because the per-account lockout already stops guessing and many people can
  share one CGNAT or VPN address. Confirmation and reset mails are also capped
  at three per account per hour. Only the adjacent private/loopback proxy is
  trusted for forwarded headers.
- Application access tokens live for one hour and refresh tokens for seven
  days. A per-account token generation immediately invalidates older HTTP
  sessions after a credential change.
- SpacetimeDB tokens are asymmetric OIDC JWTs. The module accepts only its
  pinned deployment issuer and resolves authorization from server-side rows.
  These tokens live for 30 days, so module-side access-state checks are the
  revocation boundary for already connected chat sessions.
- Production startup rejects known development secrets and endpoints.

Any new endpoint that changes or discloses user data must resolve the full
account, not only validate a JWT signature. This preserves suspension and
credential-change revocation.

Module synchronization and read-only view revocation have residual limits; see
[A4 in the finding register](Findings/BUG_ANALYSIS.md#a4).

### SpacetimeDB is the chat authorization authority

Reducers own membership, role, ownership, friendship, block, and message-scope
checks. Tables exposed to subscriptions must be filtered views unless every row
is intentionally public. Changes to reducer signatures require regenerated
client bindings; changes to a UI permission do not replace a reducer check.

### Object storage is private

MinIO must not be publicly browsable. `core-api` brokers presigned URLs only
after checking channel, DM, or own-object access; download batches are capped
at 128 keys. The [attachment flow](#attachments) defines quota reservation,
exact-length uploads, normalized references, and fail-closed collection.
Avatars/icons require `image/*` as well as the 10 MiB limit. Multipart completion
checks every part and HEAD-verifies the assembled size.

Single-PUT grants expire after 15 minutes; multipart sessions after two hours.
The one-hour lifecycle grace period allows a successful PUT to precede the
SpacetimeDB commit that binds it. An unavailable dependency or stale credential
retains the object and registry row for retry.

### LiveKit is an ephemeral media authority

`core-api` mints a LiveKit token only when the requested identity matches the
session account and SpacetimeDB confirms current presence in that room. Tokens
expire after one hour, but a removal does not wait for that: every 20 seconds
core-api compares each LiveKit room with the module's voice presence and removes
participants who have had none for two consecutive rounds (kick, ban, timeout,
leave). An unreachable module pauses the comparison instead of removing anyone.

### Administration is a separate listener

The public listener rejects `/admin/*`; the admin listener rejects public API
paths. Production compose publishes the admin listener only on
`127.0.0.1:48788`, intended for an SSH tunnel. Never route it through the public
Cloudflare or Caddy ingress.

core-api automatically reads the persisted module-owner token and registers the
archive worker. New chat registration fails closed until the issuer is pinned.
Use `ADMIN_BOOTSTRAP_USERNAME` and a generated
`ADMIN_BOOTSTRAP_PASSWORD` for the human administrator. The module owner receives
the only initial chat-domain admin row during publish; public registrations are
never implicitly promoted. Remove the account-bootstrap values after first use.

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
   session plus a 30-day OIDC access token.
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
5. Confirmed videos queue a poster job; `VideoThumbnailWorker` renders
   `{videoKey}.thumb.jpg` with ffmpeg via range reads. Chat renders that poster
   and mounts the `<video>` only on click.
5. Download endpoints re-check channel or DM access before returning a
   short-lived URL.
6. A background sweeper aborts expired multipart sessions or removes expired
   single-PUT objects before releasing their reservations. MinIO's stale-upload
   cleanup is the fallback for an initiation crash before the upload ID is saved.

Default limits: 500 MiB per attachment, 64 MiB per multipart part, 10 MiB per
avatar/space icon, and 2 GiB of uploads per user per UTC day. Daily, per-user
stored, and installation stored limits are runtime admin settings, seeded once
from `.env`; the stored limits default to unlimited. `/uploads/request` locks the
config row across users and reserves against both daily usage and retained
confirmed-plus-pending bytes. A bucket inventory must finish before stored
limits are enforced. Failed storage deletion keeps the registry row charged;
MinIO volume exhaustion is reported separately from configured quotas. Space-
specific limits and download resume remain in `.claude/plans/object-storage.md`.

### Voice and video

`core-api` issues LiveKit grants only after checking SpacetimeDB presence and
room scope. Media then travels through LiveKit; app-visible join/leave and
control state is maintained through the SpacetimeDB module.

Noise suppression runs locally on the microphone through lazily loaded RNNoise
(default) or DeepFilterNet3 AudioWorklets at 48 kHz. The model selection persists
in Audio settings and is also available from the call popover. Both models' assets
ship with the client; no Cloud license, external model host or cross-origin
isolation is required. DeepFilterNet's model/WASM only loads when selected; its
worklet reports model readiness, runtime errors and sustained CPU overload. The
app-shell owner reapplies the selected model when the microphone changes or the
user switches filters, restores raw audio on failure, and reports runtime status
separately from the persisted preference. Each processor owns and closes its
AudioContext so its WASM memory can be released after switching or hanging up.

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

## Deployment invariants

- Terminate TLS at the documented Caddy or Cloudflare ingress.
- Both public proxies reach SpacetimeDB through the chat-edge allowlist. Only
  token exchange and the letschat WebSocket pass; all other API calls return
  404. Host proxies use :44300. The raw API on loopback :44302, PostgreSQL
  and the admin listener stay private.
- The five public hostnames are configured once. Compose derives discovery
  URLs from them; native Caddy configuration handles routing, CSP and the
  browser's `/config.js`. No deployment entrypoint scripts are needed.
- Use unique generated values for PostgreSQL, MinIO, LiveKit, session JWT, OIDC
  signing, SpacetimeDB admin, archive, and tunnel secrets.
- Keep `SPACETIME_OIDC_ISSUER`, discovery URLs, and externally visible MinIO
  URLs exact and stable. Issuer changes alter SpacetimeDB identities.
- Preserve MinIO CORS settings and the web security headers documented in
  `DEPLOYMENT.md`.
- Back up PostgreSQL, SpacetimeDB data, MinIO objects, and persistent OIDC key
  material together; partial recovery can break identity or attachment links.

## Verification map

| Changed area | Minimum relevant checks |
|---|---|
| Frontend/client integration | `bun run build`, `bun run lint`, `bun run test:unit` |
| `core-api` | `bun run core-api:test`, `dotnet format core-api/CoreApi.slnx --verify-no-changes` |
| SpacetimeDB module | `cargo test --manifest-path server/Cargo.toml` plus regenerated bindings |
| Tauri Rust | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Security boundary | Relevant unit tests plus `bun run test:security` against its required stack |
| Compose/deployment | `docker compose ... config` for the affected base and overlay |

## Security review workflow

For a boundary-changing pull request:

1. State which authority makes the decision and what caller-controlled values
   cross the boundary.
2. Add a regression test that fails without the server-side check, including a
   concurrent or stale-session case when relevant.
3. Run the component tests and formatting checks from the
   [verification map](#verification-map).
4. Run `bun run test:security` when the required integration stack is available.
5. Update [`Findings/BUG_ANALYSIS.md`](Findings/BUG_ANALYSIS.md) only after the
   fix and regression test are merged.

Report suspected vulnerabilities privately through the repository owner's
preferred private channel; do not publish exploit details in a public issue
before remediation is available.

## Maintenance rules

- Treat generated bindings as build output; change the Rust module first.
- Keep `README.md`, this file, and `DEPLOYMENT.md` synchronized
  whenever a service boundary or production component changes.
- Record actionable defects and their status in `Findings/BUG_ANALYSIS.md`;
  link to code and tests instead of duplicating architectural descriptions there.
- Date scanner snapshots. Live dependency status belongs in GitHub's
  Dependabot/Security views rather than an undated count in architecture docs.
