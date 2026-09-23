# Plan: Object storage lifecycle, quotas, and resilient transfers

> **Status (2026-09-22): Phase 0 implemented and locally verified on
> `analysis`; production acceptance still requires a deployment smoke test.**
> Stored-byte quotas, multipart uploads, and resumable downloads are later
> phases. This plan is separate from `2-storage-tiering.md`, which concerns
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
- Reference rebuild must complete before inventory adoption or cleanup. Core API
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

Build quotas from `ConfirmedUpload`; do not create another usage counter that can
drift from object truth.

- Add configurable per-user, per-space, and whole-instance stored-byte limits.
- At `/uploads/request`, calculate retained bytes plus pending reservations under
  the existing user lock and reject before signing.
- Keep a confirmed object charged while deletion is pending or failing. Usage
  falls only after MinIO deletion succeeds and the registry row is removed.
- Charge the uploader for user quota and the containing space for space quota;
  DMs have no space charge.
- Expose limits and current usage through authenticated account/admin surfaces
  and discovery so clients show the effective maximum before upload.
- Keep the server/client avatar and icon limit aligned when limits become
  runtime-configurable.

## Phase 2 — Multipart uploads

Keep exact size enforcement. Multipart does not require dropping
`Content-Length`; sign and verify it per part.

1. Initiate an upload with declared total size and bounded part size.
2. Presign numbered `UploadPart` requests, each below the deployment proxy cap.
3. Persist uploaded part numbers/ETags and allow retry/resume within a TTL.
4. Complete only when ordered parts total the reserved size; then HEAD-verify and
   promote through the same `ConfirmedUpload` path.
5. Abort expired sessions and remove incomplete multipart data before releasing
   reservations.

For Cloudflare Tunnel, choose a part size below the plan's request-body limit.
The effective upload limit must be returned by discovery/configuration so the
client does not accept a file the selected topology cannot upload.

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
- Multipart retry, out-of-order/missing part, expired session, and proxy-sized
  parts preserve exact total-size enforcement.
- Browser and Tauri resumed downloads verify object identity before appending.
