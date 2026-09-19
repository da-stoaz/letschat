# Infrastructure Plan: Durability & Storage Tiering — PostgreSQL Cold Archive

> **Status (reviewed 2026-09-16): Part A implemented in production; Part B
> deferred.** All 14 durable tables replicate and rebuild, including pinned
> messages, and rebuilds reseed module-managed id counters. The current operator
> procedure is in [`DEPLOYMENT.md`](../../DEPLOYMENT.md); intermediate gap notes
> below are retained only where they still apply.

## Historical context and remaining Part B problem

Two structural problems motivated this plan:

1. **Fragile durability / destructive migrations — closed by Part A.** A
   destructive publish can wipe SpacetimeDB, but the PostgreSQL archive now
   provides the tested rebuild source.
2. **Unbounded RAM — still deferred.** SpacetimeDB keeps its working set in
   memory. Chat history continues to grow because Part B eviction has not been
   implemented.

These have **different urgency**, so this plan is split into two parts that ship independently:

| Part | Fixes | Status |
|---|---|---|
| **A — Durability (cold archive)** | Message loss + destructive-migration wipes | **DONE & verified** — replication, full rebuild, pinned messages, and id counters |
| **B — Eviction (hot/cold tiering)** | Unbounded RAM | **Deferred** — only when RAM pressure is real |

**Why the split** (decided 2026-07-21): at friends-scale, messages are tiny text rows — millions of them are a few GB of RAM, years away from a problem. Durability is needed *today*; eviction is a scale optimisation with no current trigger. Deferring eviction is *safe precisely because Part A ships first*: once a full Postgres copy exists, even an unexpected RAM ceiling loses no data — you turn on eviction then.

This plan is **E2EE-agnostic**: it mirrors opaque rows and does not care whether `content` is plaintext (today) or ciphertext (after [3-e2ee.md](3-e2ee.md)). It is **plan 2 of 4** — Part A lands before E2EE (E2EE's Phase 7 does a destructive column drop that A2's rebuild path de-risks); Part B lands whenever RAM demands it, and is a prerequisite for [4-efficiency-cache.md](4-efficiency-cache.md).

**Prerequisite (met):** the .NET `core-api` control plane is live and Postgres
is already in the stack (dev port 5433); see
[`CODEBASE.md`](../../CODEBASE.md).

---

# Part A — Durability (cold archive)

## A1 — Live replication — ✅ DONE & VERIFIED (2026-07-21, at SpacetimeDB 2.5)

> **History:** A1 was first built on the `2-storage-tiering` branch (phase-1, 2026-06-14) at SpacetimeDB 2.4, then went stale (68 commits behind, un-merged). It was **de-staled and re-verified onto main at 2.5** on branch `feat/storage-tiering-a` — module, core-api, and worker all build; a full backfill replicated **message 74, direct_message 20, user 10, channel 38 at exact parity**. An earlier idea to rewrite this as a simpler *snapshot poller* was **dropped**: the CDC implementation already exists, is correct, and solves the hard problems below better than a rewrite would.

The mechanism is a **live CDC replication worker**, not a snapshot poller:

- **Gated `archive_*` views (`server/src/views.rs`).** Every sensitive base table is private, so private tables aren't emitted into client bindings at all — the worker can't subscribe to them directly. Instead the module exposes one `archive_<table>` **view per durable table**, each gated to a registered service identity (`is_archive_service`). For any other caller they return empty, exactly like the `my_*` views. **This is why there is no owner-token coupling** — the worker uses a purpose-built service identity, not the publisher's owner token. (An earlier concern that the worker would need the owner token was wrong; the gated-view design predates and resolves it.)
- **Service-identity registration.** `ArchiveService` singleton table (`schema.rs`) + `set_archive_service_identity` reducer (`reducers/archive.rs`), instance-admin gated (same trust boundary as `set_user_admin`). One-time bootstrap: start the worker → it logs its identity → an admin calls the reducer with it → the gated views light up and the worker backfills (it subscribes to `archive_service` too, so no reconnect needed).
- **The worker (`archive-worker/`, .NET Worker Service, `SpacetimeDB.ClientSDK` 2.5.0).** Subscribes to the `archive_*` views; mirrors every insert/update/delete into Postgres through a **single-consumer write queue** (`ArchiveDatabase`) so DB I/O never blocks the client tick and writes apply in arrival order; **reconciles** the full archive against the live snapshot on each (re)subscribe; reconnects with backoff; persists its auto-issued token so its identity is stable across restarts. Handles the keyless-view delete/insert-ordering subtlety (only delete when the PK is truly gone from the SDK cache).
- **The `archive` database + schema is owned by core-api** (`Data/Archive/ArchiveDbContext` + EF migration `ArchiveInitialSchema`), applied on startup like the `auth` context. **Optional and fail-safe:** unset `ARCHIVE_DATABASE_URL` → context not registered, archive disabled; configured-but-unreachable → logged, auth continues. The archive can never take down the essential auth service.

**Scope:** all 14 durable domain tables: user, server, channel, member, ban,
join request, invite, DM server invite, message, direct message, friend, block,
read state, and pinned message. Ephemeral presence, typing, and voice tables are
deliberately not archived.

### A1 follow-ups — ✅ closed

- `PinnedMessage` is archived and restored with the rest of the durable set.
- An unregistered worker refuses reconciliation instead of interpreting gated,
  empty views as deletion of the live dataset.
- Production compose includes the worker and archive database wiring.

## A2 — Migration rebuild tooling — ✅ FULL-FLEET DONE & VERIFIED (2026-07-22)

The durability payoff: make a destructive SpacetimeDB migration non-lossy — a `--delete-data` wipe becomes *rebuild the whole database from the Postgres archive*.

- **14 restore reducers** in `server/src/reducers/archive.rs`, one per durable
  table, including `pinned_message`. They are worker-only, perform batched
  verbatim upserts, preserve primary keys and timestamps, and raise the
  module-managed id counters for auto-increment-shaped tables. Every reducer is
  idempotent per primary key, so a partial rebuild can be rerun safely.
- **Worker rebuild mode** (`archive-worker/Rebuild.cs`, `ARCHIVE_REBUILD=1`): connect as the service identity, read every `archive_*` table from Postgres (reverse of `Replication`'s column map — identities from hex, timestamps from µs BIGINT, unit enums via `Enum.Parse`, `Vec<String>` from `text[]`, options from nullable columns), call the restore reducers in 500-row batches, then exit.

**Verified end-to-end** on a throwaway `rebuildtest` database with fixtures
spanning all 14 durable tables: seed → replicate → publish with `--delete-data`
→ re-register the worker → rebuild → compare exact row parity. Enums, arrays,
options, microsecond timestamps, explicit ids, pins, and post-rebuild inserts are
covered by `tests/security/archive-rebuild.test.ts` and the rebuild fixture.

### Operator runbook (destructive migration)
1. **Maintenance mode** — pause client writes (brief downtime).
2. **Drain** — confirm the replication worker is caught up (archive == live counts), then stop it.
3. **Wipe + republish** — `spacetime publish --delete-data` with the new schema. This also wipes the `archive_service` registration.
4. **Re-register the worker identity** — as the module owner: `spacetime sql <db> "INSERT INTO archive_service (id, service_identity) VALUES (1, 0x<worker-identity>)"` (no admin user exists post-wipe, so use owner SQL, not the admin reducer).
5. **Rebuild** — run the worker once with `ARCHIVE_REBUILD=1`; it reloads from Postgres and exits. (A per-migration transform on the old→new row shape is the only bespoke part if columns changed; message/dm currently restore 1:1.)
6. **Restart** the worker in steady-state; **exit maintenance mode.**

**Why this matters now:** E2EE ([3-e2ee.md](3-e2ee.md)) Phase 7 drops the `deleted`/`deleted_by_*` columns on message/direct_message — exactly the tables A2 covers. A2 turns that from "wipe history" into "rebuild from archive."

## Verification checklist (Part A)
1. **Mirror fidelity** — Postgres matches SpacetimeDB after inserts/edits/deletes. ✅ (backfill parity 74/20/10/38)
2. **Worker resilience** — kill/restart mid-stream → reconciles, no loss/duplicates. ✅ (reconnect + reconcile path)
3. **Bootstrap** — register the service identity → gated views deliver → backfill. ✅
4. **Migration rebuild** (A2) — destructive test migration → rebuild → ids/timestamps/relationships intact. ✅
5. **Post-rebuild ids** — restored maxima raise module-managed `IdCounter`
   rows; a fresh insert after rebuild does not collide. ✅

---

# Part B — Eviction (hot/cold tiering) — DEFERRED

**Trigger to build:** SpacetimeDB RAM becomes a real limit (monitor host RAM vs module memory). Not before — Part A already guarantees durability.

When that day comes, Part B keeps only a hot working set in SpacetimeDB and serves older history from the archive. It builds directly on A1's live CDC worker (the low-lag mirror is exactly what safe copy-before-evict needs). The worker's reconcile already carries a `NOTE (phase 2)` marking where Message/DirectMessage reconcile must switch to hot-window scoping so an **evicted** row (absent upstream) is not mistaken for a **deleted** one.

## What Part B adds
- **Hotness rule:** keep the last N messages per conversation in SpacetimeDB (default N ≈ 100). RAM bounded by `conversation_count × N × avg_row_size`. Only `Message`/`DirectMessage` evicted; bounded tables stay resident.
- **`archive_evict(message_ids)` / `archive_evict_dm(ids)` reducers** (worker-only): bulk hard-delete aged rows *after* confirming they're safely in Postgres. Replaces A1's "absent == deleted" reconcile assumption.
- **Archive read API (`core-api`):** `GET /archive/channel-messages` / `/archive/direct-messages`, JWT-authorized, membership-checked, reading Postgres.
- **Client hot/cold stitching:** scroll above the hot window → fetch older pages from the archive API; recent stays live. Cold ranges are snapshots. Change `connection.ts` to subscribe to the hot window instead of all messages.
- **Evicted-message edit/delete write-through:** cold target → `PATCH`/`DELETE /archive/messages/:id` on core-api. (Rejected: "promotion" back into SpacetimeDB — reintroduces demand-driven RAM.)

## Hand-off notes for Part B / E2EE / cache
- **Eviction ≠ deletion.** Once eviction exists, "row absent, no deletion signal" means *possibly evicted, fetch from archive*. This is why [4-efficiency-cache.md](4-efficiency-cache.md)'s tombstones and long-offline reconciliation depend on **Part B**, not Part A.
- **E2EE-agnostic throughout.** When [3-e2ee.md](3-e2ee.md) lands, `content` becomes ciphertext; the archive holds ciphertext just as happily — no changes to A1/A2/B machinery.

## Effort (Part B, when triggered)
~3–3.5 weeks: eviction + reducers ~0.5 week · hot-window reconcile switch ~0.5 week · archive read API + client stitching ~1.5 weeks · evicted-message write-through ~0.5 week.
