# Plan: Object storage lifecycle, quotas, and resilient transfers

> **Status (2026-09-23): Phases 0 and 2 committed on `feature/object-storage`;
> Phase 1 is being implemented locally, not yet production-accepted.**
> Resumable downloads remain a later phase. This plan is
> separate from `2-storage-tiering.md`, which concerns
> hot/cold message rows.

## Goal and invariants

The first goal is to prevent permanent orphaned objects without risking deletion
of a live attachment. Temporary staging between independent systems is allowed,
but it must be registered, bounded by a grace period, and recoverable.

The implementation must preserve these invariants:

1. Core API records an upload before returning a presigned MinIO URL.
2. An object is not eligible for cleanup until its PUT was HEAD-verified and its
   confirmed registry row has exceeded the grace period.
3. Storage references change in the same SpacetimeDB transaction as their owning
   message, DM, avatar, or server icon.
4. Cleanup fails closed if reference state, authorization, or either backing
   service is unavailable or ambiguous.
5. The decision that a key is unreferenced and the prevention of a new reference
   to that key are one atomic SpacetimeDB operation. A read followed by a delete
   is not sufficient because a reference could be created between them.
6. Core API removes registry state only after MinIO deletion succeeds. Failures
   remain registered and are retried.

## Phase 0 — Authoritative lifecycle

### Data model

- PostgreSQL `PendingUpload`: reservation created before presigning.
- PostgreSQL `ConfirmedUpload`: HEAD-verified uploaded object awaiting or owning
  an application reference.
- SpacetimeDB `StorageReference`: derived durable mapping from a storage key to
  its owning entity.
- SpacetimeDB `StorageReferenceState`: readiness marker proving references were
  rebuilt for the deployed schema.
- SpacetimeDB `StorageDeletionClaim`: tombstone proving that cleanup atomically
  found a key unreferenced. Claims are retained so a deleted key cannot later be
  rebound by a stale or malicious client. This is small metadata, not object
  payload.
- SpacetimeDB `StorageCleanupBatch`: the latest bounded claim batch accepted for
  each cleanup identity. Claims carry its indexed batch id, so the protected
  view returns at most the current batch instead of scanning every permanent
  tombstone ever created.

### Upload and reference flow

1. `/uploads/request` validates the declared metadata and creates
   `PendingUpload` before returning one presigned PUT.
2. `/uploads/confirm` HEAD-verifies the real object size and, in one PostgreSQL
   transaction, promotes the reservation to `ConfirmedUpload` and charges the
   daily upload-rate counter.
3. Existing attachment envelopes are parsed server-side. Message, DM, avatar,
   and icon reducers validate ownership/scope and write `StorageReference` rows
   in the same transaction as the owning mutation.
4. Replacements and deletes remove their old references in that transaction.
   Domain reducers refuse to bind any key that already has a deletion claim.
5. `rebuild_storage_references` reconstructs the derived reference table after
   deployment or restore and then publishes the readiness marker.

### Cleanup flow

1. Core API imports pre-registry `uploads/` bucket inventory into
   `ConfirmedUpload`, so upgrades do not leave unknown legacy objects.
2. After the grace period, Core API submits a fresh batch id and at most 500
   candidates to the admin-only `claim_unreferenced_storage` reducer.
3. The reducer checks readiness and atomically creates deletion claims only for
   keys with no `StorageReference`. Concurrent/new reference creation checks the
   same claim table and therefore cannot win after the claim.
4. The reducer records the accepted batch for the exact admin identity it used.
   Core API queries with that same credential. The admin-only view uses the
   indexed batch id and includes an explicit authorization/readiness sentinel;
   a missing sentinel is an error, never an empty result.
5. Core API deletes only claimed objects from MinIO. It removes the corresponding
   PostgreSQL registry row only after that deletion succeeds; otherwise it
   retries later. The SpacetimeDB claim remains as a tombstone.

This removes the time-of-check/time-of-use deletion race. A short staged interval
between PUT and the owning chat commit remains unavoidable across MinIO,
PostgreSQL, and SpacetimeDB, but it is tracked and bounded rather than unknown or
permanent.

### Rollout and recovery

- Deployments are fail-closed in either order: an older module lacks the claim
  reducer/view and therefore prevents cleanup; an older Core API never invokes
  cleanup claims.
- The cleanup credential must be a Core API service token mapped to a current
  SpacetimeDB system administrator. User tokens must not expose lifecycle views
  or reducers.
- Reference rebuild must complete before deletion claims or cleanup. Bucket
  inventory adoption itself is non-destructive and may run earlier; Core API
  cleanup must be stopped during a destructive SpacetimeDB reset so no in-flight
  claim can outlive the tombstone table. The normal domain/archive restore and a
  reference rebuild must finish before cleanup resumes.
- Current message rows remain present in SpacetimeDB. Before future storage-tier
  eviction is enabled, attachment references must remain durable independently
  of the hot message row (or be restored from the archive); rebuilding from only
  the hot set would otherwise make cold attachments appear unreferenced.

### Client download safety included in this phase

Tauri downloads write to a unique `.part` path and rename it only after a full
successful flush. Cancellation, network errors, and disk-write errors remove the
partial file instead of exposing it under the requested final name. Download
resume remains a later phase.

## Phase 1 — Stored-byte quotas

Implement the agreed scope now: configurable per-user daily upload allowance,
per-user retained-object allowance, and an optional whole-installation retained-
object allowance. A LetsChat installation (Core API + its MinIO bucket) is the
"instance"; it is not a chat space. Keep the existing 2 GiB/day default. Seed
the new settings once from environment variables, let the admin panel change
them at runtime, and use `0 = unlimited` only for stored-byte allowances. Both
stored-byte limits default to unlimited so existing installations are not
silently capped; the operator can set either independently. Per-space quotas
are deferred: channel keys contain a
channel id, not a reliable immutable space id, and the request endpoint does
not currently validate that mapping. Do not pretend a per-space number is
enforced by charging every channel upload to an arbitrary space.

1. Use `ConfirmedUpload` (including adopted legacy objects) plus `PendingUpload`
   as the stored-byte source of truth. Do not add an independently mutable usage
   counter. A confirmed object remains charged while cleanup is claimed,
   waiting, or failing; usage falls only after MinIO deletion succeeds and the
   registry row is removed. An expired/failed pending reservation remains
   charged until abort/sweep removes it after storage cleanup.
2. Before enforcing stored-byte limits, complete the existing bucket inventory
   import for this Core API process. Inventory adoption only adds registry rows;
   move it ahead of the SpacetimeDB reference-readiness check, which still gates
   every deletion claim. If inventory fails, reject quota-limited new requests
   with a retryable service error instead of accepting against an incomplete
   registry. Unlimited installations retain the old availability behavior. Do
   not scan the bucket per request.
3. Serialize `/uploads/request` across users with one PostgreSQL config-row
   lock, then lock the existing user/day quota row. Inside that transaction,
   check daily charged bytes + today's pending reservations and stored confirmed
   bytes + **all** pending reservations against the effective limits before
   inserting the new pending row. Compute each retained+pending sum in one SQL
   statement/snapshot so a concurrent pending→confirmed promotion cannot fall
   between separate sums. This deliberately simple global lock is adequate for
   the current low upload-request rate; measure before adding counters/shards.
   Lowering a limit blocks new requests but does not delete existing objects or
   invalidate already-reserved upload sessions. Confirm remains idempotent and
   honors accepted reservations; only pre-reservation legacy rows need a final
   daily check.
4. Return distinct, actionable errors for file, daily, user stored, and instance
   stored limits. Publish static limits in discovery; keep usage private (an
   authenticated account read and an admin-only aggregate view). The server is
   authoritative; a stale client hint must never grant an upload.
5. A full MinIO volume is **not** the same as an application quota. Recognize
   MinIO's `XMinioStorageFull` / HTTP 507 on the direct PUT and show a clear
   "storage full, contact the instance admin" error even when the instance
   limit is unlimited. Do not mark the upload confirmed. Best-effort abort a
   failed single-PUT reservation promptly; retain tracked state for the sweeper
   if abort fails. Preserve multipart parts for retry after transient errors,
   and let explicit cancel/expiry release their reservations. Exercise these
   cases with simulated storage responses; do not fill the real dev volume.

Verification: migration/one-time env seed and admin edits, quota boundaries,
parallel requests by one and multiple users, old pending/confirmed migration,
inventory-unavailable fail-closed behavior, failed cleanup still charged,
successful cleanup released, HTTP 507/XML storage-full wording, abort failure
retaining recovery state, and existing multipart/authorization suites. Staging
must verify a real MinIO low-space response and the configured production
volume before claiming production acceptance.

## Phase 2 — Multipart uploads

This phase can be implemented before Phase 1; it does not create a stored-byte
quota or change the existing daily upload-rate reservation.

Keep the existing single-PUT protocol for files up to the configured part
size. Multipart-capable clients use S3-compatible multipart above it; old
clients retain their single-PUT behavior and proxy limitations. Initial
defaults are 64 MiB per part (below Cloudflare Free/Pro's 100 MB *per-request*
body limit) and 500 MiB per file. The 2 GiB/user/UTC-day upload-rate limit
remains unchanged. Stored-byte quotas are Phase 1 and are not silently
introduced by multipart.

The part size and per-file maximum are runtime `SystemConfig` values, seeded
once from `UPLOAD_PART_SIZE_MIB` and `UPLOAD_MAX_FILE_SIZE_MIB`. Existing
installations already have a config row, so migration/initialization must seed
these *new fields* once without overwriting later admin edits. The admin panel
edits both, validates S3's non-final-part minimum and the 90 MiB part ceiling
for the Cloudflare Free/Pro proxy cap, and publishes effective bytes in
discovery. New requests observe a saved value immediately; every pending
session freezes its own part size and reserved file size. Old clients still use one PUT up to the
configured per-file maximum; behind Cloudflare they retain the older 100 MB
per-request ceiling.

1. `/uploads/request` still validates metadata, checks/reserves the full file
   size, and records `PendingUpload` before creating a MinIO multipart session.
   Store the MinIO upload ID on that row. If initiation or persisting the ID
   fails, abort the MinIO session when possible. Keep the existing response
   shape for single PUT; return mode, part size/count, and application upload ID for
   multipart-capable clients.
2. An authenticated part-URL endpoint checks session ownership, expiry, part
   number, and the *exact expected length* for that part, then presigns its
   `UploadPart` PUT with `Content-Length`. The browser/Tauri webview sends
   `File.slice(...)` directly to MinIO, reports aggregate progress, and retries
   only failed parts. Bound simultaneous parts to avoid needless memory use.
3. A status endpoint obtains completed part numbers, sizes, and ETags from
   MinIO `ListParts`. MinIO is the source of truth: do not add a second ETag
   table. A live client can continue after a network interruption within the
   session TTL. Cross-reload resume requires reselecting and identifying the
   original local file; do not claim that capability until it is implemented
   and tested.
4. `/uploads/confirm` (or an explicitly named multipart completion endpoint)
   locks the pending session, lists parts server-side, requires consecutive
   parts with exactly the expected sizes and total, then completes in order
   with MinIO's ETags. HEAD-verify the assembled object and promote it through
   the existing `ConfirmedUpload`/daily-counter transaction. On retry after a
   crash between MinIO completion and DB promotion, reconcile an already
   completed, correctly sized object instead of creating a second charge.
5. On cancellation/expiry, abort the multipart session before dropping the
   pending reservation. Failed aborts retain tracked state for retry. Because
   incomplete parts are invisible to the normal object inventory, configure
   and verify MinIO's built-in stale-multipart cleanup as the fallback for a
   crash between MinIO initiation and persisting its upload ID. Do not add a
   duplicate application-wide incomplete-upload scanner unless testing proves
   that fallback insufficient. Never abort an active session.

Presigned part URLs must expire no later than their session. The multipart
session TTL must be long enough for the configured maximum over a realistic slow
connection, and the sweeper must not race completion. Browser CORS must allow
the part PUTs; reading part ETags in the client is unnecessary because the API
uses `ListParts`. Downloads remain one assembled object and are unchanged by
this phase. The API should advertise the file and part limits so clients do
not maintain a divergent hard-coded maximum.

## Phase 3 — Resumable downloads

- Browser: use the File System Access API when available so large downloads do
  not assemble the whole file in RAM; retain the Blob fallback for unsupported
  browsers with a clear size warning.
- Tauri: retain `.part` plus final rename while adding resume.
- Persist received length/ETag and request the remainder with `Range` and
  `If-Range`; restart from zero when the object changed.

## Phase 0 verification

Automated checks completed locally:

- [x] 140/140 Core API tests, including migration discovery, bounded claim
  payload, same-credential query, and missing-sentinel fail-closed behavior.
- [x] 86/86 SpacetimeDB security tests, including channel/DM/avatar/icon
  reference lifecycle, edit/replace, channel/space cascade, non-admin and
  revoked-admin access, and both claim/reference orderings; 2/2 Rust tests.
- [x] 40/40 frontend unit tests; frontend and website production builds, lint,
  Tauri `cargo check`, `.NET` format verification, both EF model/migration
  comparisons, all dev/prod Compose configurations, and `git diff --check`.

Disposable local integration checks completed:

- [x] Wiped local dev and applied PostgreSQL migrations from empty databases.
  Published the module to a fresh database. Separately published the `main`
  module to a populated throwaway database and upgraded it to this branch
  without `--delete-data`: user/message rows survived, and the rebuild restored
  a legacy attachment reference that blocked a deletion claim.
- [x] Presigned PUT + HEAD-confirm + avatar binding. An aged live object stayed
  in PostgreSQL and MinIO; removing the reference led to a claim, MinIO delete,
  registry delete, and rejection of a later rebind.
- [x] Simulated interruption after PUT and after confirm: expired pending and
  unreferenced confirmed objects were collected after the respective grace
  conditions. Message, DM, channel, space, avatar, and icon reference mutations
  are covered by the black-box reducer tests; the collector's MinIO path was
  exercised with avatar objects.
- [x] Stopped SpacetimeDB: a candidate retained its registry row and object.
  After recovery the retry removed both. Stopped MinIO: the claim persisted,
  the registry row stayed, and the next sweep after recovery removed both.
- [x] Empty-bucket startup, populated-bucket inventory adoption, and old
  objects with and without live references. A live adopted object survived an
  aged cleanup pass; after its reference was removed, the next pass collected it.

Still required before production acceptance/release:

- [ ] Exercise the actual deployment topology and service credentials in staging,
  including a rolling window with old and new module/Core API versions. Local
  tests used a module-owner service token; Compose syntax alone does not prove
  the deployed credential or proxy wiring.
- [ ] Run interrupted/cancelled Tauri downloads in the packaged app and verify
  that no final file or abandoned `.part` remains. The current check compiles
  this path but does not execute the GUI download.

Only after those deployment checks pass may Phase 0 be considered
production-accepted and released.

## Later-phase verification

- Concurrent quota requests cannot exceed any configured stored-byte limit.
- Browser and Tauri resumed downloads verify object identity before appending.

## Phase 2 verification

- [x] 144/144 Core API tests with opt-in live MinIO and temporary PostgreSQL
  migration tests: wrong signed part length rejected, parts listed/completed,
  missing part rejected, owner checked, confirm idempotent, abort and expiry
  sweep remove multipart sessions, and existing config rows seed new fields once.
- [x] Frontend unit tests (42/42), frontend and website production builds,
  86/86 SpacetimeDB security tests, lint, `.NET` format, EF model comparison,
  and dev/tunnel/Caddy Compose syntax.
- [x] Local MinIO browser and Tauri-origin multipart PUT preflights returned
  `204` with matching `Access-Control-Allow-Origin` and `PUT` allowed.
- [ ] Verify >100 MB upload and browser/Tauri CORS through the deployed
  Cloudflare Tunnel. Exercise both direct and interrupted transfers in the
  packaged clients; local tests cover the shared upload code, not the GUI.
- [ ] Verify MinIO stale-multipart cleanup on the exact production image after
  a crash between initiation and PostgreSQL update. The app explicitly aborts
  tracked expired sessions, but cannot test the 24-hour storage fallback in a
  short local run.
