# Plan: Invert Identity Authority — core-api becomes the OIDC issuer for SpacetimeDB

## Context

**The disease:** SpacetimeDB is currently the authority over identity; core-api is a
bystander that stores a *copy*.

Today's flow:

1. The client connects to SpacetimeDB **anonymously**. SpacetimeDB mints an identity +
   token, signed with SpacetimeDB's own key
   ([`connection.ts:218-227`](../../src/lib/spacetimedb/connection.ts)).
2. The client registers/logs in against core-api, passing that `spacetimeIdentity` +
   `spacetimeToken`.
3. core-api stores them verbatim — `ApplicationUser.SpacetimeIdentity` /
   `SpacetimeToken` are documented as *"stored exactly as the client supplied it"*
   ([`ApplicationUser.cs:21-28`](../../core-api/src/CoreApi/Data/ApplicationUser.cs)).
   core-api has **zero control** over the identity.
4. Login re-connects and then checks whether the live SpacetimeDB identity still equals
   the stored copy, throwing *"Login token is stale for this account… relink this
   device"* when they diverge
   ([`auth.ts:110-123`](../../src/lib/spacetimedb/auth.ts)).

That staleness check exists **only because the copy can go stale**. The source of truth
for "who owns this data" lives inside the thing we wipe. Wipe SpacetimeDB → every stored
identity/token is a ghost → Postgres holds a pointer to nothing. This is the entire class
of bug hit this session (orphaned accounts, forced device-relink, "stale token").

**The cure (standard SpacetimeDB pattern):** make **core-api the OIDC issuer**.
SpacetimeDB trusts it and *derives* the identity from a core-api-signed JWT. The account's
Postgres GUID becomes the seed of the SpacetimeDB identity, so identity becomes
**deterministic and wipe-proof**: re-mint a token for the same account → same identity,
forever. No orphaning, no relink dance — the whole problem class disappears. It also makes
core-api the cryptographic root of identity, which is the direction the
[E2EE / sovereignty north-star](3-e2ee.md) needs regardless.

**Why now is free:** everything is already wiped. Doing this normally requires
re-identifying every existing account (a real migration); on a clean slate the migration
cost is **zero**. Do it right, now.

### Verified mechanism (SpacetimeDB 2.5)

- **Identity is a deterministic hash of `iss` + `sub`**
  ([blog: "Who are you?"](https://spacetimedb.com/blog/who-are-you)):
  ```
  h        = blake3(issuer + "|" + subject)[:26]
  checksum = blake3([0xC2, 0x00, *h])[:4]
  identity = 0xC2 0x00 ++ checksum ++ h        // 32 bytes, big-endian
  ```
  This is ~10 lines to reproduce in core-api → **core-api can compute the resulting
  identity itself**, with no client round-trip. (Decision: compute server-side.)
- **Trust is discovery-driven, not a server flag.** SpacetimeDB reads the token's `iss`
  claim, fetches `{iss}/.well-known/openid-configuration` → the JWKS endpoint → the public
  key, and verifies the signature ([issue #2600](https://github.com/clockworklabs/SpacetimeDB/issues/2600)).
  So "configuring the trusted issuer" = core-api exposing those two endpoints at a URL the
  SpacetimeDB server can reach, and the token's `iss` matching that URL byte-for-byte.
- **Asymmetric keys only** (RS256 / ES256). JWKS publishes a *public* key; the existing
  `AUTH_JWT_SECRET` (HS256, symmetric) cannot be used for the SpacetimeDB token — a new
  keypair is required. Session tokens stay HS256, unchanged. (Upstream issue #2600 leaves
  "does SpacetimeDB support a symmetric-key fallback" as an open question rather than a
  documented no — but it doesn't matter here: JWKS discovery only ever publishes public
  keys, so RS256/ES256 is the only shape that fits this trust model regardless of how that
  question resolves.)
- **Required claims:** `iss`, `sub` (drive the identity), plus `exp`; set `aud` = module
  name for hygiene.

### Scope boundary — do NOT couple this to "phase out SpacetimeDB"

This inversion is correct **whether or not** SpacetimeDB is ever removed, and it is a small,
deletion-heavy change. Fully phasing out SpacetimeDB is an order-of-magnitude-larger,
separate project (rewriting the real-time subscription layer, the reducer permission model,
live sync) and nothing here forces it. Ship this first; it stands on its own.

---

## ⚠️ The one thing that must not change, ever

**The `iss` string is baked into every identity's hash.** Pick **one canonical issuer URL**
and freeze it for the life of the deployment. Changing it later re-hashes every account
into a different identity — a silent, total orphaning. Two hard constraints:

1. The `iss` value in the minted token and the URL the SpacetimeDB **server** fetches
   OIDC metadata from must be **byte-identical**.
2. That URL must be reachable **server-to-server** from SpacetimeDB to core-api. In dev,
   SpacetimeDB runs in Docker (`:4300`) and core-api on the host (`:8787`) — mind
   `localhost` vs `host.docker.internal`. Choose the canonical `iss` with this in mind and
   make core-api emit it consistently regardless of which interface the request arrived on.

Treat `iss` as a permanent, deployment-level constant (an env var with no silent default),
documented alongside `AUTH_JWT_SECRET`.

---

## Phase 1 — core-api becomes the issuer

1. **Keypair.** Generate/load an RSA (or EC) keypair. Private key from a secret
   (`SPACETIME_OIDC_PRIVATE_KEY` / PEM path); no dev default that survives to prod (mirror
   `FindInsecureDefaults` guarding in [`ServiceOptions.cs`](../../core-api/src/CoreApi/Configuration/ServiceOptions.cs)).
2. **Issuer config.** New required option `SPACETIME_OIDC_ISSUER` (the canonical URL) +
   `aud` = existing `SpacetimeModuleName`.
3. **Discovery endpoints** (public listener, since the SpacetimeDB server calls them):
   - `GET /.well-known/openid-configuration` → `{ issuer, jwks_uri }`
   - `GET /.well-known/jwks.json` → the public key as a JWK set.
   Put these in `MiscEndpoints` next to the existing `/.well-known/letschat.json`.
4. **`SpacetimeTokenService.Mint(user)`** → RS256 JWT
   `{ iss, sub = user.Id, aud, iat, exp }`. Choose an `exp` and a refresh strategy (the
   client re-mints via a session-authenticated endpoint rather than SpacetimeDB re-issuing).
5. **Identity computation.** Port the blake3 derivation (add the `Blake3` NuGet). Compute
   `Identity(iss, sub)` and store it in `SpacetimeIdentity` / `SpacetimeIdentityNorm` at
   account creation. Now **write-once and permanent** — the unique index still guards
   one-account-per-identity, but it can never go stale.

## Phase 2 — rewrite the auth endpoints

In [`AuthEndpoints.cs`](../../core-api/src/CoreApi/Endpoints/AuthEndpoints.cs):

- `Register` (create path) / `Link` (create-new-account path, `:179-211`): **stop reading**
  client-supplied `SpacetimeToken` / `SpacetimeIdentity`. Compute the identity from
  `user.Id`; mint the token. Delete the client-supplied-token validation and the
  `SpacetimeIdentity`-collision-from-client checks (identity is now derived, collisions are
  structurally impossible for distinct accounts).
- **`Register`'s pending-confirmation response must still carry the identity.**
  [`CredentialsForm.tsx:89-105`](../../src/features/auth/CredentialsForm.tsx) currently
  calls `rotateIdentityForRegistration()` to force an anonymous connect *before*
  registering, purely so it has a `spacetimeIdentity` to stash in
  [`PendingRegistration`](../../src/features/auth/state.ts#L9-L13) — which
  [`useEmailConfirmationPoll.ts:51`](../../src/features/auth/useEmailConfirmationPoll.ts)
  then sends to `/auth/registration-status` (`RegistrationStatus`, `:421-445`) so the poll
  can locate the account **without leaking whether a username exists** (its own doc comment
  says so). Phase 4 deletes anonymous pre-connect entirely, so this capture path
  disappears with it. Since core-api now computes the identity deterministically at
  `Register` time — before any connection — the fix is one field: add the computed
  identity to `RegisterResponse` for the `pending_email_verification` case, and have
  `CredentialsForm` read it from the response instead of from
  `useConnectionStore().identity`. No pre-connect, no behavior change to the
  no-enumeration guarantee.
- **`Link`'s existing-account branch (`:145-177`) needs a different gate, not a deletion.**
  That branch isn't account creation — it's how
  [`SettingsPanel.tsx:471`](../../src/features/settings/SettingsPanel.tsx) lets a
  signed-in user set/change their password, authenticated today by "the caller's
  `SpacetimeIdentityNorm` matches the account's stored one." That check is exactly the
  copy-equality pattern this plan removes, and "identity is derived from `user.Id`" doesn't
  give this branch anything to check instead — the identity is public-ish and *permanently*
  valid, so it can no longer stand in for "is currently signed in." Re-gate this branch on
  a valid core-api session (require `SessionToken` from an already-authenticated request)
  rather than an identity match.
- `Login`: delete the `pending:` placeholder-swap block (`:238-269`) — accounts get their
  real, deterministic identity at creation, so admin-created accounts no longer need
  first-login binding. `BuildAuthResponse` returns the freshly minted token.
- **Delete** `RefreshSpacetimeToken` (`:330-352`). **`RenewSession` (`:312-328`) is not
  login-adjacent housekeeping** — [`uploadSession.ts:26-46`](../../src/lib/uploadSession.ts)
  calls it via `renewAuthSession()` any time the app-session JWT is close to expiry,
  mid-session (uploads, LiveKit calls), so it's a live, frequently-hit path, not a one-off.
  Its current auth story is the same stored-token equality lookup this plan is deleting
  everywhere else. The replacement "re-mint on demand for a valid session" should mean:
  verify the presented SpacetimeDB JWT's own signature + `exp` (core-api holds the private
  key, so this is a real cryptographic check, not a DB lookup), read `sub` directly off it
  — that's the account's `user.Id`, no separate `spacetimeIdentity` request field needed at
  all.
- `SpacetimeClient.SyncUserAdminAsync` keeps working — it already takes the hex identity,
  which core-api now knows immediately (no waiting for first connect), so the best-effort
  retry dance in `SyncAdminFlagBestEffort` can be simplified.

## Phase 3 — SpacetimeDB server + module

- **Module:** no code change. `ctx.sender` is opaque; it simply becomes the derived
  identity. Confirm no reducer assumes anonymous-identity semantics (spot-check
  `registerUser` and the admin gate).
- **Server:** ensure the standalone SpacetimeDB instance can reach `{iss}` and accepts the
  issuer (discovery is automatic on first token; verify against 2.5's actual behavior when
  wiring dev — this is the integration point to test first, before touching the client).

## Phase 4 — client (deletion-heavy)

In [`connection.ts`](../../src/lib/spacetimedb/connection.ts) /
[`auth.ts`](../../src/lib/spacetimedb/auth.ts):

- New flow: **log in to core-api → receive minted token → `connect()` with it.** No
  anonymous pre-connect.
- Delete `rotateIdentityForRegistration`, the `sameIdentity` / "relink this device" checks
  (`auth.ts:110-134`), and passing `spacetimeIdentity`/`spacetimeToken` into
  `authServiceLogin`. `rotateIdentityForRegistration`'s only caller,
  `CredentialsForm.tsx:89-105`, goes with it — see the Phase 2 `RegisterResponse` change
  above for what replaces its identity capture.
- The stored-token-rejection fallback (`connection.ts:429-440`) largely goes away — a
  minted token is always valid for the current issuer; a rejected one means re-mint via
  core-api, not "connect anonymously."
- `onConnect` still records the identity for display, but it's now confirmation, not the
  source of truth.

## Verification

- **Integration test first (Phase 3):** stand up dev, mint a token in core-api, connect a
  raw SpacetimeDB client with it, assert `ctx.sender` == core-api's computed identity.
  This proves the issuer trust + hash port before any client refactor.
- xUnit test in `CoreApi.Tests` for the blake3 derivation against a known
  `(iss, sub) → identity` vector (generate one from a real minted-token connection).
- Existing `LoginTests` / `RegisterTests` updated to the mint-based flow.
- Manual: register → wipe SpacetimeDB data → log in again → same identity, no relink, chat
  User row re-registers cleanly.

## Open decisions (resolved)

- **Identity source:** compute server-side in core-api (blake3 port). *(resolved)*
- **Phase-out of SpacetimeDB:** explicitly out of scope here. *(resolved)*
- **Token lifetime / refresh:** TBD in Phase 1 — pick `exp` + a session-authenticated
  re-mint endpoint.
