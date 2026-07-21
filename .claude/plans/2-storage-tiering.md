# Infrastructure Plan: Durability & Storage Tiering — PostgreSQL Cold Archive

## Context

Two structural problems with the current SpacetimeDB setup:

1. **Fragile durability / destructive migrations.** A destructive schema change (drop a column, change a type) makes `spacetime publish` halt on a "requires deleting data" prompt; the only way through is `--delete-data`, which **wipes message history**. There is no second copy to restore from. This is the real "messages must never be lost" risk.
2. **Unbounded RAM.** SpacetimeDB keeps its working set in memory — docs: *"the practical limit is the available RAM on the host."* Chat grows forever, so RAM grows forever.

These have **different urgency**, so this plan is split into two parts that ship independently:

| Part | Fixes | Status |
|---|---|---|
| **A — Durability (cold archive)** | Message loss + destructive-migration wipes | **A1 replication DONE & verified; A2 rebuild tooling = next** |
| **B — Eviction (hot/cold tiering)** | Unbounded RAM | **Deferred** — only when RAM pressure is real |

**Why the split** (decided 2026-07-21): at friends-scale, messages are tiny text rows — millions of them are a few GB of RAM, years away from a problem. Durability is needed *today*; eviction is a scale optimisation with no current trigger. Deferring eviction is *safe precisely because Part A ships first*: once a full Postgres copy exists, even an unexpected RAM ceiling loses no data — you turn on eviction then.

This plan is **E2EE-agnostic**: it mirrors opaque rows and does not care whether `content` is plaintext (today) or ciphertext (after [3-e2ee.md](3-e2ee.md)). It is **plan 2 of 4** — Part A lands before E2EE (E2EE's Phase 7 does a destructive column drop that A2's rebuild path de-risks); Part B lands whenever RAM demands it, and is a prerequisite for [4-efficiency-cache.md](4-efficiency-cache.md).

**Prerequisite (met):** the .NET `core-api` rebuild owned by [1-control-panel.md](1-control-panel.md) is done — Postgres is already in the stack (dev port 5433).

---

# Part A — Durability (cold archive)

## A1 — Live replication — ✅ DONE & VERIFIED (2026-07-21, at SpacetimeDB 2.5)

> **History:** A1 was first built on the `2-storage-tiering` branch (phase-1, 2026-06-14) at SpacetimeDB 2.4, then went stale (68 commits behind, un-merged). It was **de-staled and re-verified onto main at 2.5** on branch `feat/storage-tiering-a` — module, core-api, and worker all build; a full backfill replicated **message 74, direct_message 20, user 10, channel 38 at exact parity**. An earlier idea to rewrite this as a simpler *snapshot poller* was **dropped**: the CDC implementation already exists, is correct, and solves the hard problems below better than a rewrite would.

The mechanism is a **live CDC replication worker**, not a snapshot poller:

- **Gated `archive_*` views (`server/src/views.rs`).** Every sensitive base table is private, so private tables aren't emitted into client bindings at all — the worker can't subscribe to them directly. Instead the module exposes one `archive_<table>` **view per durable table**, each gated to a registered service identity (`is_archive_service`). For any other caller they return empty, exactly like the `my_*` views. **This is why there is no owner-token coupling** — the worker uses a purpose-built service identity, not the publisher's owner token. (An earlier concern that the worker would need the owner token was wrong; the gated-view design predates and resolves it.)
- **Service-identity registration.** `ArchiveService` singleton table (`schema.rs`) + `set_archive_service_identity` reducer (`reducers/archive.rs`), instance-admin gated (same trust boundary as `set_user_admin`). One-time bootstrap: start the worker → it logs its identity → an admin calls the reducer with it → the gated views light up and the worker backfills (it subscribes to `archive_service` too, so no reconnect needed).
- **The worker (`archive-worker/`, .NET Worker Service, `SpacetimeDB.ClientSDK` 2.5.0).** Subscribes to the `archive_*` views; mirrors every insert/update/delete into Postgres through a **single-consumer write queue** (`ArchiveDatabase`) so DB I/O never blocks the client tick and writes apply in arrival order; **reconciles** the full archive against the live snapshot on each (re)subscribe; reconnects with backoff; persists its auto-issued token so its identity is stable across restarts. Handles the keyless-view delete/insert-ordering subtlety (only delete when the PK is truly gone from the SDK cache).
- **The `archive` database + schema is owned by core-api** (`Data/Archive/ArchiveDbContext` + EF migration `ArchiveInitialSchema`), applied on startup like the `auth` context. **Optional and fail-safe:** unset `ARCHIVE_DATABASE_URL` → context not registered, archive disabled; configured-but-unreachable → logged, auth continues. The archive can never take down the essential auth service.

**Scope:** durable domain tables only (user, server, channel, member, ban, join_request, invite, dm_server_invite, message, direct_message, friend, block, read_state). Ephemeral tables (presence, typing, voice) are deliberately **not** archived.

### A1 gaps to close (small)
- **`PinnedMessage` is not archived.** It was added to main after the branch was cut, so no `archive_pinned_messages` view / entity exists yet. Add the view + EF entity for parity. (Non-blocking; pins are small and reconstructable.)
- **Unregistered-worker behaviour:** before its identity is registered, the gated views are empty and the worker's reconcile will **empty** the archive to match. Correct-but-surprising; document the bootstrap ordering (register before relying on the archive).
- **Prod compose:** the worker + archive DB are wired into `docker-compose.dev.yml` only (opt-in `archive` profile). Add to the prod compose when Part A ships to prod.

## A2 — Migration rebuild tooling — ⏭️ NEXT (ship now, per 2026-07-21 decision)

The durability payoff: make a destructive SpacetimeDB schema change non-lossy.

- New reducer `archive_restore(rows)` (worker-only, in `reducers/archive.rs`): verbatim insert during rebuild — explicit primary keys (auto-inc honoured only for sentinel `0`), explicit timestamps, bypasses validation/permission logic.
- Worker **rebuild mode**: read every archive row from Postgres, apply a per-migration **transform** (old-schema → new-schema), insert via `archive_restore`. With eviction deferred, rebuild loads **all** rows (no hot-set selection) — strictly simpler.
- **Runbook:** maintenance mode → final replication drain → `spacetime publish --delete-data` → rebuild from Postgres → exit. The per-migration transform is the only bespoke part.

**Why now:** E2EE ([3-e2ee.md](3-e2ee.md)) Phase 7 drops the `deleted`/`deleted_by_*` columns — a destructive migration. A2 turns that from "wipe history" into "rebuild from archive."

## Verification checklist (Part A)
1. **Mirror fidelity** — Postgres matches SpacetimeDB after inserts/edits/deletes. ✅ (backfill parity 74/20/10/38)
2. **Worker resilience** — kill/restart mid-stream → reconciles, no loss/duplicates. ✅ (reconnect + reconcile path)
3. **Bootstrap** — register the service identity → gated views deliver → backfill. ✅
4. **Migration rebuild** (A2) — destructive test migration → rebuild → ids/timestamps/relationships intact. ⏭️ pending A2.

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
