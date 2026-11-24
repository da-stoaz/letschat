# LetsChat security model

> Security baseline reviewed 2026-11-19 at version 1.7.0.

This document defines the trust boundaries and invariants that security fixes
must preserve. [`Findings/BUG_ANALYSIS.md`](../Findings/BUG_ANALYSIS.md) is the actionable finding
register; GitHub's security views are the live source for dependency alerts.

## Trust boundaries

### The client is untrusted

React, Tauri, and generated SpacetimeDB bindings may hide unavailable actions,
but client-side checks never grant access. Every `core-api` endpoint and every
Rust reducer must authenticate and authorize the caller independently.

Do not accept a username, SpacetimeDB identity, server id, room name, storage
key, role, or claimed file metadata merely because the client supplied it.

Application and SpacetimeDB tokens are currently persisted in webview
`localStorage`, including desktop builds; they are not protected by an OS
keychain. Preventing script injection therefore matters directly to credential
protection:

- The hosted web client ships an enforced CSP (`deploy/web/Caddyfile`). It
  withholds `'unsafe-inline'` scripts and limits `connect-src` to the
  instance's own services. `'unsafe-eval'` is required: the SpacetimeDB SDK
  builds its row decoders at runtime.
- The desktop CSP (`src-tauri/tauri.conf.json`) also withholds inline scripts,
  but allows any HTTPS/WSS `connect-src`, because the app connects to whatever
  servers the user adds.
- The app sets `no-referrer`, so signed media URLs never leak to other origins
  through the `Referer` header.

The desktop app grants camera, microphone and screen capture to its own pages
without a webview prompt (`media_permission` in `src-tauri/src/main.rs`); the
click on Camera, Mute or Share is the consent and the OS privacy controls still
apply. Any other page the window might reach gets the platform default. Script
injection into the app could therefore capture media without a prompt, which
is one more reason the CSP above matters.

### `core-api` is the identity authority

- Accounts and roles use ASP.NET Core Identity backed by PostgreSQL.
- Passwords are Argon2id hashes and inputs are limited to 8–128 characters.
- Five failed sign-in attempts lock an account for five minutes.
- The public JSON API has a 256 KiB request-body limit. Files never transit it.
- Every `/auth` path shares a per-IP token bucket (burst 20, then 5 per
  second). At most four password-hashing requests run at once across the
  process; further ones are rejected instead of queued, so Argon2id cannot be
  used to exhaust CPU and memory.
- Abuse-prone auth endpoints use IP-partitioned fixed-window rate limiters,
  one budget each for registration, email actions, and password actions, so
  flooding one flow cannot lock another. Sign-in gets ten times the budget,
  because the per-account lockout already stops guessing and many people can
  share one CGNAT or VPN address. Confirmation and reset mails are also capped
  at three per account per hour, at least 60 seconds apart. Only the adjacent
  private/loopback proxy is trusted for forwarded headers.
- Application access tokens live for one hour and refresh tokens for seven
  days. A per-account token generation immediately invalidates older HTTP
  sessions after a credential change.
- SpacetimeDB tokens are asymmetric OIDC JWTs. The module accepts only its
  pinned deployment issuer and resolves authorization from server-side rows.
  These tokens live for 30 days. The public chat gateway checks current
  PostgreSQL account status and token generation before admitting a socket.
  Local credential/status changes close revoked sockets immediately; each
  connection also rechecks every five seconds, with a three-second query
  timeout, and closes if validation fails or the token expires.
- Production startup rejects known development secrets and endpoints.

Any new endpoint that changes or discloses user data must resolve the full
account, not only validate a JWT signature. This preserves suspension and
credential-change revocation.

Chat admission uses single-use, 30-second opaque tickets and revalidates the
account when consuming them. Views and procedures share the same revocable
socket as reducers. Module views cannot distinguish token generations, so the
raw SpacetimeDB API must remain private. Only operators and backend services
may use that trusted path.

Credential changes persist the password and generation together. Account access
is pushed to the module immediately and replayed from PostgreSQL in bounded
batches after failures, restarts or module rebuilds. Older generations cannot
overwrite newer module access state. Public chat revocation does not wait for
this replica to catch up.

### SpacetimeDB is the chat authorization authority

Reducers own membership, role, ownership, friendship, block, and message-scope
checks. Tables exposed to subscriptions must be filtered views unless every row
is intentionally public. Changes to reducer signatures require regenerated
client bindings; changes to a UI permission do not replace a reducer check.

### Object storage is private

MinIO must not be publicly browsable. `core-api` brokers access with presigned
URLs:

- attachments default to a 500 MiB per-file maximum, configurable by an admin;
  avatars/icons remain limited to 10 MiB and `image/*`;
- the initial per-user upload-rate limit is 2 GiB per UTC day, configurable by
  an admin independently of optional per-user and installation stored limits;
- upload requests reserve the declared bytes under a PostgreSQL config-row
  lock, preventing concurrent users from overbooking the installation limit;
- the exact `Content-Length` is signed for a single PUT or each multipart part,
  and signed upload URLs expire after ten minutes;
  multipart completion checks every part and HEAD-verifies the assembled size;
- single-PUT grants expire after 15 minutes; multipart sessions after two hours.
  The sweeper deletes or aborts them before releasing quota, with MinIO's stale
  multipart cleanup covering a crash before the upload ID reaches PostgreSQL;
- confirmation retains a PostgreSQL registry row, while SpacetimeDB creates and
  removes normalized object references atomically with the owning chat row;
- the lifecycle collector adopts legacy MinIO inventory, then an admin-gated
  reducer atomically claims only unreferenced keys; all reference writers reject
  claimed keys, and a protected claim view must return its
  authorization/readiness sentinel before deletion;
- an unavailable dependency or stale credential fails closed and retains the
  object and registry row for retry;
- download grants are issued only after the caller's channel, DM, or own-object
  access is checked, and expire after one hour; batch requests are capped at
  128 keys;
- executable MIME types are refused at upload, but the type is the one the
  client declares, so this is a convenience rather than a boundary. Download
  URLs never reuse the uploader's `Content-Type`: types the client shows inline
  get their canonical type and everything else is forced to download, so an
  uploaded HTML file never runs as a page on the files domain.

The one-hour lifecycle grace period is intentional: a successful PUT can briefly
precede the SpacetimeDB commit that binds it, but it can no longer become an
unknown or permanent orphan.

### Untrusted media is processed in a sandboxed ffmpeg

core-api renders video posters and HLS playback renditions from user uploads
with ffmpeg. Each run:

- executes as `nobody` with `no_new_privs` (via `setpriv` in the image) and an
  empty environment, so it can read neither core-api's secrets nor its `/proc`
  environment;
- accepts only the `http,https,tcp,tls` protocols and a fixed list of container
  formats, which stops a crafted playlist from making the server fetch other
  URLs;
- reads the source through a short-lived internal signed URL, at below-normal
  priority, with bounded work: 30 seconds per poster, and per rendition job
  30 minutes, at most two hours of input, 8K frames and 2 GiB of output. One
  encoder runs per installation (a PostgreSQL advisory lock).

Playback grants are HMAC-signed with a key derived from `AUTH_JWT_SECRET` for
that purpose only, so a grant can never act as a session token. Each grant is
scoped to one video and lasts one hour. Playlists are `no-store` and
`no-referrer`, and their segments are private signed MinIO URLs; no account
token appears in a media URL.

### Invite links reveal at most a space name

`/invite/{token}` on core-api renders the link-preview card for messengers.
Tokens that do not match the module's format are never looked up. The page is
`no-store`, `no-referrer` and `noindex`. The module's `invite_preview` returns
the space name only for a live invite open to anyone, since its holder could
join and read it anyway; username-restricted, expired and used-up invites get
the same generic card.

### LiveKit is an ephemeral media authority

`core-api` mints a LiveKit token only when the requested identity matches the
session account and SpacetimeDB confirms current presence in that room. Tokens
expire after one hour, but a removal does not wait for that: every 20 seconds
core-api compares each LiveKit room with the module's voice presence and removes
participants who have had none for two consecutive rounds (kick, ban, timeout,
leave). An unreachable module pauses the comparison instead of removing anyone.

### Desktop updates come only from signed project releases

A saved server can only name a version (`recommendedClient` in discovery). The
app parses it as a version, requests that exact release's feed from the
project's GitHub Releases, rejects a feed describing any other version, and
offers only versions newer than itself. Packages are verified against the
updater public key compiled into the app before installing, and nothing
installs until the user restarts to update. A hostile server can therefore
neither supply a binary nor force a downgrade. The private key is the
`TAURI_SIGNING_PRIVATE_KEY` release secret. macOS builds are signed and
notarized; Windows installers are not yet Authenticode-signed, which affects
SmartScreen but not this updater check.

### Administration is a separate listener

The public listener rejects `/admin/*`; the admin listener rejects public API
paths. Production compose publishes the admin listener only on
`127.0.0.1:48788`, intended for an SSH tunnel. Never route it through the public
Cloudflare or Caddy ingress. Admin sign-in uses its own `letschat.admin` cookie,
which expires after eight hours without activity, and shares the
password-work limit above.

core-api automatically reads the persisted module-owner token and registers the
archive worker. New chat registration fails closed until the issuer is pinned.
Use `ADMIN_BOOTSTRAP_USERNAME` and a generated
`ADMIN_BOOTSTRAP_PASSWORD` for the human administrator. The module owner receives
the only initial chat-domain admin row during publish; public registrations are
never implicitly promoted. Remove the account-bootstrap values after first use.

## Deployment invariants

- Terminate TLS at the documented Caddy or Cloudflare ingress.
- Both public proxies reach the core-api chat gateway through the chat-edge allowlist. Only
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
- Preserve MinIO CORS restrictions and the web security headers documented in
  `DEPLOYMENT.md`.
- Back up PostgreSQL (accounts and the chat archive), SpacetimeDB data, MinIO
  objects, `core_api_data` (OIDC signing key), `module_init_home` (module owner
  identity) and `archive_worker_data` together; partial recovery can break
  identity or attachment links.

## Current operational security debt

The 2026-11-10 dependency refresh (PR #112) left advisories only in build
tooling (`minimatch`, `zod` 3 through `eslint-plugin-react-hooks`, `deepmerge`
through `shadcn`); none of them reaches shipped code.

One Cargo alert remains: stable Tauri 2's Linux GTK stack still resolves
`glib 0.18.5`, while the advisory is fixed in `glib 0.20`. The fixed release is
not compatible with that dependency chain, and Tauri 3 is still prerelease, so
the application does not take an alpha framework upgrade solely to force the
transitive version. Recheck this constraint on the next stable Tauri release.

Use the live [Dependabot alerts](https://github.com/da-stoaz/letschat/security/dependabot)
for package versions and remediation status; do not copy that changing list into
the architecture document.

Every entry in the overview of
[`Findings/BUG_ANALYSIS.md`](../Findings/BUG_ANALYSIS.md) is fixed or accepted
(checked 2026-11-19). Documented residual risks remain, notably:

- ffmpeg still runs inside the core-api container and keeps network access
  (limited by the protocol whitelist). A separate worker container would be
  the next step.
- The video job queue is not limited per uploader, so one account can delay
  everyone else's posters and renditions.
- Tokens live in webview `localStorage` (see "The client is untrusted").

## Security review workflow

For a boundary-changing pull request:

1. State which authority makes the decision and what caller-controlled values
   cross the boundary.
2. Add a regression test that fails without the server-side check, including a
   concurrent or stale-session case when relevant.
3. Run the component tests and formatting checks from `CODEBASE.md`.
4. Run `bun run test:security` when the required integration stack is available.
5. Update `Findings/BUG_ANALYSIS.md` only after the fix and regression test are merged.

Report suspected vulnerabilities privately through the repository owner's
preferred private channel; do not publish exploit details in a public issue
before remediation is available.
