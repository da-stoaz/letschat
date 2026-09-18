# LetsChat security model

> Security baseline reviewed 2026-09-18 at version 1.0.16.

This document defines the trust boundaries and invariants that security fixes
must preserve. [`BUG_ANALYSIS.md`](BUG_ANALYSIS.md) is the actionable finding
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
keychain. Preventing script injection and moving CSP from report-only to
enforcement therefore matters directly to credential protection (finding E4).

### `core-api` is the identity authority

- Accounts and roles use ASP.NET Core Identity backed by PostgreSQL.
- Passwords are Argon2id hashes and inputs are limited to 8–128 characters.
- Five failed sign-in attempts lock an account for five minutes.
- The public JSON API has a 256 KiB request-body limit. Files never transit it.
- Abuse-prone auth endpoints use an IP-partitioned fixed-window rate limiter;
  only the adjacent private/loopback proxy is trusted for forwarded headers.
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

The module's copy of account suspension and minimum token generation is pushed
best-effort. If SpacetimeDB is unavailable during a credential/status change,
HTTP revocation still applies but an already connected chat session can retain
reducer access until a later synchronization succeeds. The failure is logged;
operators should retry the status change after recovery. Read-only `my_*` views
also do not pass through reducer revocation checks (A4 residual risk).

### SpacetimeDB is the chat authorization authority

Reducers own membership, role, ownership, friendship, block, and message-scope
checks. Tables exposed to subscriptions must be filtered views unless every row
is intentionally public. Changes to reducer signatures require regenerated
client bindings; changes to a UI permission do not replace a reducer check.

### Object storage is private

MinIO must not be publicly browsable. `core-api` brokers access with presigned
URLs:

- a single object is limited to 500 MiB;
- a user is limited to 2 GiB per UTC day;
- upload requests reserve the declared bytes under a PostgreSQL row lock;
- the exact `Content-Length` is signed and verified against the stored object;
- unconfirmed grants expire after 15 minutes and a background sweeper deletes
  their objects before releasing quota;
- download grants are issued only after the caller's channel, DM, or own-object
  access is checked; batch requests are capped at 128 keys.

Deletion of confirmed objects when their owning message or channel is removed
is not yet complete; this residual lifecycle issue is tracked as D4 in
`BUG_ANALYSIS.md`.

### LiveKit is an ephemeral media authority

`core-api` mints a LiveKit token only when the requested identity matches the
session account and SpacetimeDB confirms current presence in that room. Tokens
expire after one hour. Immediate token revocation following kick/ban is still
open as A10 in `BUG_ANALYSIS.md`.

### Administration is a separate listener

The public listener rejects `/admin/*`; the admin listener rejects public API
paths. Production compose publishes the admin listener only on
`127.0.0.1:48788`, intended for an SSH tunnel. Never route it through the public
Cloudflare or Caddy ingress.

For first boot, configure `SPACETIMEDB_SERVICE_TOKEN` with the persisted module
owner token, then use `ADMIN_BOOTSTRAP_USERNAME` and a generated
`ADMIN_BOOTSTRAP_PASSWORD` for the human administrator. The module owner receives
the only initial chat-domain admin row during publish; public registrations are
never implicitly promoted. Remove the account-bootstrap values after first use.

## Deployment invariants

- Terminate TLS at the documented Caddy or Cloudflare ingress.
- Expose only the documented public web/API, SpacetimeDB, LiveKit, and MinIO
  routes. PostgreSQL and the admin listener stay private.
- Use unique generated values for PostgreSQL, MinIO, LiveKit, session JWT, OIDC
  signing, SpacetimeDB admin, archive, and tunnel secrets.
- Keep `SPACETIME_OIDC_ISSUER`, discovery URLs, and externally visible MinIO
  URLs exact and stable. Issuer changes alter SpacetimeDB identities.
- Preserve MinIO CORS restrictions and the web security headers documented in
  `DEPLOYMENT.md`.
- Back up PostgreSQL, SpacetimeDB data, MinIO objects, and persistent OIDC key
  material together; partial recovery can break identity or attachment links.

## Current operational security debt

The 2026-09-16 dependency refresh upgraded the web app, static site, Rust,
.NET, Tauri, and SpacetimeDB dependency sets. `bun audit`, the static site's
`npm audit`, and NuGet's transitive vulnerability scan are clean; the former
`quinn-proto` alert is patched by `0.11.18`.

One known Cargo alert remains: stable Tauri 2's Linux GTK stack still resolves
`glib 0.18.5`, while the advisory is fixed in `glib 0.20`. The fixed release is
not compatible with that dependency chain, and Tauri 3 is still prerelease, so
the application does not take an alpha framework upgrade solely to force the
transitive version. Recheck this constraint on the next stable Tauri release.

Use the live [Dependabot alerts](https://github.com/da-stoaz/letschat/security/dependabot)
for package versions and remediation status; do not copy that changing list into
the architecture document.

The remaining code findings are prioritized in
[`BUG_ANALYSIS.md`](BUG_ANALYSIS.md). At this baseline there is no open S1;
open S2 items are C4, C5, C6, and C7.

## Security review workflow

For a boundary-changing pull request:

1. State which authority makes the decision and what caller-controlled values
   cross the boundary.
2. Add a regression test that fails without the server-side check, including a
   concurrent or stale-session case when relevant.
3. Run the component tests and formatting checks from `CODEBASE.md`.
4. Run `bun run test:security` when the required integration stack is available.
5. Update `BUG_ANALYSIS.md` only after the fix and regression test are merged.

Report suspected vulnerabilities privately through the repository owner's
preferred private channel; do not publish exploit details in a public issue
before remediation is available.
