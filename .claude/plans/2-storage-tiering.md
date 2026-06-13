# Infrastructure Plan: Storage Tiering — SpacetimeDB Hot Tier + PostgreSQL Cold Archive

## Context

Two structural problems with the current SpacetimeDB setup must be fixed **before** the E2EE plan is implemented:

1. **Unbounded RAM.** SpacetimeDB holds all data in memory — verified against its docs: *"SpacetimeDB holds all data in memory… the practical limit is the available RAM on the host."* Larger-than-memory storage is roadmap-only, not shipped. Chat messages grow forever, so RAM grows forever.
2. **Rigid migrations.** Destructive SpacetimeDB schema changes (dropping a column, changing a type) require wiping table data — `spacetime publish` halts on a "requires deleting data" prompt.

This plan fixes both with one mechanism: a **PostgreSQL cold archive** kept as a continuous full replica of SpacetimeDB by a **replication worker**, plus **eviction** that keeps only a hot working set in SpacetimeDB.

This plan is **E2EE-agnostic**. It replicates and tiers opaque rows; it does not care whether `content` is plaintext (today) or ciphertext (after the E2EE plan). It is **plan 2 of 4** — implemented after `1-control-panel.md` and before `3-e2ee.md`.

**Backend language:** the backend services here are built in .NET Core. The replication worker is a .NET Worker Service. The core-api rebuild in .NET on ASP.NET Core Identity (`1-control-panel.md`) is **done** — `core-api/` is live on .NET 10 + PostgreSQL, so this plan's archive endpoints land on an existing service.

**Status note (2026-06-11 review):** the stack is now SpacetimeDB **2.4.1** (server image, CLI, TS SDK). The C# client SDK `SpacetimeDB.ClientSDK` 2.4.1 is on NuGet (released 2026-06-05) — pin the worker to the same 2.4.x line as everything else, and generate its bindings with `spacetime generate --lang csharp`.

---

## Open decisions

**Scope note:** decision 1 blocks **Phase 4 (migration tooling / `archive_restore`) only**. Phases 1–3 (replication, eviction, archive reads) never insert explicit ids and are unaffected — they can ship while decision 1 is open.

1. **`auto_inc` id collision after rebuild — DEFERRED (2026-06-12) until Phase 4.** SpacetimeDB sequences are NOT advanced by explicit-value inserts. After `archive_restore` re-inserts rows with their original ids into a fresh database, the sequence restarts at 1 and newly auto-generated ids collide with restored ids (unique-constraint failures on the very first new message). Affects every restored `#[auto_inc]` table: Message, DirectMessage, Server, Channel, DmServerInvite. Phases 1–3 are unaffected (no explicit-id inserts). Avenues verified closed (2026-06-11): the module ABI has `RawSequenceDefV10.start` but `#[auto_inc]` exposes no parameters; re-adding `auto_inc` over restored data fails the `CheckAddSequenceRangeValid` auto-migration precheck; no sequence-set API exists (`st_sequence` is a system table, not safely writable). **Default fix when Phase 4 starts:** drop `#[auto_inc]` on these tables (an always-allowed automatic migration) and allocate ids from a small module-managed counter table inside the send/create reducers; `archive_restore` then sets each counter to `max(restored id) + 1`. **In parallel:** file an upstream issue/PR for `#[auto_inc(start = ...)]` or a sequence-restart API (backup/restore use case) — if it lands first, the fix shrinks to one line in the migration runbook with no reducer changes.
2. **Cascade deletes vs. cold archive — DECIDED (2026-06-11): purge immediately.** `delete_server` / `delete_channel` hard-delete all messages in scope from SpacetimeDB, but evicted (cold) rows for that scope exist only in PostgreSQL and receive no per-row delete events. The worker treats the disappearance of a channel/server row as a scoped purge: it deletes that scope's cold rows from the archive. No grace period.
3. **DM "deleted by both" parity — DECIDED (2026-06-11): exact parity.** `delete_direct_message` hard-deletes the row once both sides have flagged it. The cold write-through path (§7) reimplements this exactly: when the second side deletes an evicted DM, core-api removes the PostgreSQL row.

---

## Goals

- **Bound SpacetimeDB RAM**: SpacetimeDB holds only a hot working set; PostgreSQL holds full history.
- **Defang destructive migrations**: PostgreSQL is a continuously-maintained full copy, so a destructive SpacetimeDB schema change becomes *wipe + rebuild-from-cold*.
- **No change to real-time behavior** for recent messages — the app keeps reading/writing SpacetimeDB exactly as it does now.

## Non-goals

- Replacing SpacetimeDB. SpacetimeDB remains the source of truth and the real-time engine.
- Server-side search of message content (out of scope; also blocked later by E2EE regardless).

---

## Architecture

```
[Client]
  ├─ SpacetimeDB (WS)        — real-time, hot set, source of truth (unchanged)
  └─ core-api (HTTP)     — old-history reads from the cold archive (new endpoints)

[Replication worker]  — connects to SpacetimeDB as a client
  ├─ steady state: SpacetimeDB → PostgreSQL  (mirror every insert/update/delete)
  ├─ eviction:     deletes aged rows from SpacetimeDB (frees RAM)
  └─ rebuild mode: PostgreSQL → SpacetimeDB  (only during a migration)
```

- **Steady-state data flow is one direction**: SpacetimeDB → PostgreSQL. The app never writes PostgreSQL directly (except the narrow evicted-message edit/delete path, §7).
- **The reverse flow (PostgreSQL → SpacetimeDB) happens only during a controlled migration**, in a maintenance window, with writes paused. An occasional controlled restore is not bidirectional sync — there is no dual-write trap.
- **The worker is the single authority** for both replication and eviction, so it never confuses "evicted" with "deleted".

---

## Components

### 1. PostgreSQL cold archive

A new `archive` **database** on the PostgreSQL server that plan 1 already added to Docker Compose (dev: `letschat-dev-postgres`, port 5433, which already hosts the `auth` database). Holds a **full, current copy of every SpacetimeDB table** — the bounded tables (User, Server, Channel, ServerMember, …) so a rebuild can restore them, and the unbounded tables (Message, DirectMessage) which are the bulk.

- Tables mirror SpacetimeDB tables column-for-column, storing rows **verbatim**: original primary keys, timestamps, every field. No transformation in steady state.
- A `replication_state` table tracks the worker's sync watermarks (last full snapshot, last reconcile) — SpacetimeDB exposes no resumable log position, so this is observability state, not a cursor.
- Indexes for the read pattern: `(channel_id, sent_at)` on messages, `(conversation_key, sent_at)` on direct messages (`conversation_key` = sorted identity pair).
- Capable of insert, update (edits), and delete (the mirror reflects all three).
- **Retention: forever.** This is the full archive; eviction never removes rows from PostgreSQL. Note the actual delete semantics in the module: a user "delete" of a channel message is a **soft delete** (sets `deleted = true`, blanks `content`) — it mirrors as an *update*, and the redacted row stays in both tiers. Rows are hard-deleted from SpacetimeDB only by: DM deleted-by-both-sides, channel/server cascade deletes, and eviction. The worker propagates the first two to PostgreSQL; eviction it recognizes as its own and ignores.

**The core-api is already on .NET and this PostgreSQL server** (rebuild completed under `1-control-panel.md`). Its data lives in the **separate `auth` database**, distinct from the new `archive` database. `auth` and `archive` stay as separate databases to isolate their very different workloads (auth: small, critical, frequent tiny reads; archive: large, append-mostly) while sharing one server to operate.

### 2. Replication worker (`archive-worker/`)

A new **.NET Worker Service** (a long-running .NET background-worker process, `SpacetimeDB.ClientSDK` 2.4.x, bindings from `spacetime generate --lang csharp`). Authenticates to SpacetimeDB as a dedicated **service identity**.

- **Data access — via gated views, not raw tables.** All sensitive base tables are private (table-visibility lockdown) and private tables are *not emitted into generated client bindings at all* — the worker cannot subscribe to them directly. Instead, add **service-gated views** (`archive_messages`, `archive_direct_messages`, `archive_users`, …, one per mirrored table) in `server/src/views.rs` that return all rows when `ctx.sender()` is the service identity and an empty set otherwise — the same pattern the `my_*` views already use. View subscriptions deliver the initial snapshot plus incremental insert/update/delete events, exactly like the client's `my_*` subscriptions today. *(Phase 1 spike: confirm the C# SDK 2.4.x subscribes to views the same way the TS SDK does before building further.)*
- **Initial backfill**: the first subscription's initial snapshot delivers all current rows; upsert into PostgreSQL by primary key (idempotent).
- **Steady state**: on each insert/update/delete event, apply the corresponding upsert/delete to PostgreSQL. (Remember: user deletes of channel messages arrive as *updates* — soft delete.)
- **Resilience**: on disconnect/restart, re-subscribe — SpacetimeDB has no resumable change-log position; every (re)subscribe delivers a fresh full snapshot, which the worker upserts. Hard-deletes missed while offline are reconciled by diffing: for **bounded tables** (small), full diff — any PostgreSQL row absent from the snapshot is deleted. For **Message/DirectMessage**, diff **within the hot window only** — a row in PostgreSQL, inside the hot window, absent from the snapshot was hard-deleted (DM-both-deleted or cascade) and is removed from PostgreSQL; rows outside the hot window are assumed evicted, never "deleted". A cascade is also detectable directly: the channel/server row disappearing triggers a scoped purge of its cold rows (per open decision 2).
- **Idempotent throughout** — every operation keyed by primary key, safe to replay. `replication_state` records last-sync watermarks for observability (not a log position — none exists).
- **Replication lag** is acceptable in steady state but must be drained to zero before a migration (§6).

### 3. Eviction

The worker also enforces the **hotness rule** and frees SpacetimeDB RAM.

- **Hotness rule**: keep the **last N messages per conversation** in SpacetimeDB (default N ≈ 100, configurable). This is self-adjusting — an active conversation's hot set is recent activity; a dormant one keeps its last N regardless of age; reactivation slides the window forward automatically. RAM is bounded by `conversation_count × N × avg_row_size`, independent of time or total volume.
- Only `Message` and `DirectMessage` are evicted. Bounded tables (User, Server, Channel, …) stay fully in SpacetimeDB.
- For each conversation exceeding N, the worker confirms the surplus oldest rows are safely in PostgreSQL, then calls a reducer (`archive_evict`) to hard-delete them from SpacetimeDB. Deleting rows shrinks SpacetimeDB's in-memory tables — verified RAM reclamation.
- Because the worker performs eviction itself, it always knows which absences are its own evictions vs. user deletes.

### 4. Archive read API (core-api)

New endpoints on the existing core-api, reading PostgreSQL:

- `GET /archive/channel-messages?channel_id&before&limit`
- `GET /archive/direct-messages?conversation_key&before&limit`

Authorization: JWT (same as other core-api endpoints). The endpoint verifies the caller is a member of the channel / a participant in the DM before returning rows. Membership is a bounded, hot table — core-api checks it against SpacetimeDB (or its PostgreSQL mirror).

### 5. Client changes

- When the user scrolls above the oldest **hot** message, the client fetches older pages from the archive API instead of expecting them from SpacetimeDB.
- Recent messages still arrive via SpacetimeDB subscriptions (the `my_channel_messages` / `my_direct_messages` views), exactly as today. No subscription change is needed for the hot window — eviction bounds what the views return. The client stitches the live (hot) range and the archive (cold) range.
- **Eviction is visible to clients as row-removal events** on those subscriptions. The client's live-event handling must not treat these as deletions: user deletes of channel messages are soft (updates), so a removed message row whose channel still exists is *evicted* — keep it rendered if on-screen (it's now cold), drop it from the hot store. A removed row alongside its channel/server row removal is a cascade delete.
- Cold-served ranges are **snapshots** — they do not live-update. This matches standard infinite-scroll chat behavior (Discord, Slack); scrolled-back history is not expected to update live.

### 6. Migration procedure — the payoff

When a destructive SpacetimeDB schema change is required:

1. Enter maintenance mode (pause client writes; brief downtime).
2. Let the worker **drain**: confirm PostgreSQL is fully caught up (replication lag = 0).
3. Apply the schema change: `spacetime publish --delete-data` → SpacetimeDB is empty with the new schema.
4. Run the worker in **rebuild mode**: it reads from PostgreSQL, applies a per-migration **transform** (old-schema row → new-schema row), and inserts via the `archive_restore` reducer, which preserves original primary keys and timestamps.
5. Rebuild loads only the **hot set** (last N per conversation); the rest stays in PostgreSQL.
6. Exit maintenance mode.

The per-migration transform function is the only bespoke part, written once per destructive migration. Because only the hot set is reloaded, the rebuild is fast and the maintenance window is short.

### 7. Edge case — editing/deleting an already-evicted message

A message old enough to have been evicted lives **only in PostgreSQL** — SpacetimeDB no longer has the row. The normal `edit_message` / `delete_message` reducers operate on a SpacetimeDB row, so they cannot touch it. This is rare (year-old messages are seldom edited), so it is handled with a small dedicated path, not a general system.

**Rejected — a "promotion" system:** hauling the old message (and surrounding context) back from PostgreSQL into SpacetimeDB so the normal reducer can run. This would make SpacetimeDB RAM demand-driven and unpredictable again — the exact problem tiering solves — and require re-eviction logic and cache-thrash handling. Disproportionate machinery for a rare action.

**Chosen — a write-through path:** the change is written *directly to PostgreSQL*, bypassing SpacetimeDB, because PostgreSQL is the only place the message exists.

- The client knows whether a target message is hot (arrived via a SpacetimeDB subscription) or cold (arrived via an `/archive/*` fetch). For a cold message it calls an core-api endpoint — `PATCH /archive/messages/:id` or `DELETE /archive/messages/:id` — instead of a reducer.
- The core-api checks authorization (own message, etc.) and applies the change to the PostgreSQL row. It resolves the caller's SpacetimeDB identity via the mirrored `user` table (username → identity), and must mirror the reducers' semantics: channel-message delete = set `deleted`, blank `content`; DM delete = set the caller's side flag, and remove the row when both flags are set (open decision 3).
- **Tradeoff:** no SpacetimeDB broadcast, so other users viewing that same cold range do not see the change *live* — they see it on their next fetch of that range. Acceptable: cold ranges are already snapshots (standard infinite-scroll behavior), and a simultaneous second viewer of that exact old range is vanishingly rare.
- **Boundary race:** if a message is evicted between the user opening the editor and saving, the reducer call fails with "row not found"; the client falls back to the write-through endpoint.

(If a cold edit ever needed to feel live, the single message could be briefly restored into SpacetimeDB, edited via the normal reducer so it broadcasts, then re-evicted — a one-message special case, not the rejected general system.)

---

## New SpacetimeDB reducers & views (`server/src/reducers/archive.rs`, `server/src/views.rs`)

All gated **only** to the worker's service identity (stored module-side at provisioning, checked against `ctx.sender()` — same pattern as the existing admin gating):

- `archive_evict(message_ids)` / `archive_evict_dm(ids)` — bulk hard-delete of aged rows from SpacetimeDB (chunked; reducer-arg size limits apply).
- `archive_restore(rows)` — insert during rebuild with explicit primary keys, explicit timestamps, all fields; bypasses normal validation and permission logic. **Requires resolving open decision 1 first** — explicit-id inserts do not advance `auto_inc` sequences, so without the counter-table change, post-rebuild inserts collide.
- `archive_*` **views** — service-gated full-table views the worker subscribes to (§2).

**Schema impact:** adding reducers and views is additive. If open decision 1 lands as recommended, dropping `#[auto_inc]` is also an always-allowed automatic migration, plus one new (additive) counter table — still no destructive migration.

---

## New / modified files

| Path | Change |
|---|---|
| `archive-worker/` | New **.NET Worker Service** (SpacetimeDB.ClientSDK 2.4.x + C# bindings): backfill, steady-state replication, eviction, rebuild mode |
| `cold-archive/migrations/` | PostgreSQL schema + migrations for the mirrored tables (`archive` database) |
| `server/src/views.rs` | New service-gated `archive_*` full-table views for the worker |
| `server/src/reducers/archive.rs` | New `archive_evict*` and `archive_restore` reducers |
| `server/src/lib.rs` | Register the archive reducers/views; provision the worker service identity |
| `server/src/schema.rs` + send/create reducers | (Open decision 1) drop `#[auto_inc]` on restored tables; counter-table id allocation |
| `core-api/` (archive) | New `/archive/*` read endpoints + evicted-message write-through (ASP.NET Core); cold-archive data access. (The .NET rebuild itself is **done** — `1-control-panel.md`.) |
| `src/lib/spacetimedb/sync.ts` / `events.ts` + message stores | Historical-load path calls the archive API; stitch hot + cold ranges; treat message row-removals as eviction, not deletion |
| `docker-compose.dev.yml` / prod compose files | Add the `archive` database (PostgreSQL service already exists) and the `archive-worker` service |

---

## Implementation Phases

### Phase 1 — Cold archive + replication worker (days 1–10)
- **Day-1 spike:** C# SDK 2.4.x subscribing to a service-gated view end-to-end (generate bindings, connect, snapshot + live events). This de-risks the whole worker design.
- Create the `archive` database + mirrored schema on the existing PostgreSQL service.
- Add the service-gated `archive_*` views + service-identity provisioning to the module.
- `archive-worker`: a .NET Worker Service — service-identity auth to SpacetimeDB, initial backfill from subscription snapshots, steady-state replication of insert/update/delete events, idempotent upserts, reconnect/reconcile logic, `replication_state` watermarks.
- Verify: PostgreSQL matches SpacetimeDB row-for-row after inserts, edits, and deletes; the worker survives kill/restart with no loss or duplication.

### Phase 2 — Eviction (days 11–15)
- Hotness rule (last N per conversation); `archive_evict*` reducers; worker eviction loop with copy-confirmed-before-delete ordering.
- Verify: SpacetimeDB RAM stays flat as message volume grows; the hot set is exactly last N per conversation.
- **Phase 1 carry-over (must address here):**
  - `Replication.ReconcileAll` currently does a *full* diff for Message/DirectMessage — correct only while nothing is evicted. Once eviction lands it **must** be scoped to the hot window, or reconcile will delete evicted rows from the archive. Flagged in `archive-worker/Replication.cs` (`ReconcileAll` doc comment).
  - The `OnDelete` handler scans `handle.Iter()` per delete (O(n)) to distinguish an in-place update's stale half from a real delete — fine for rare deletes, but O(n²) under bulk eviction. Rework the eviction-delete path to bypass this scan (eviction already knows the row is gone). See `archive-worker/Replication.cs` (`Wire` `OnDelete`).

### Phase 3 — Archive read API + client (days 16–20)
- core-api `/archive/*` endpoints with membership authorization; PostgreSQL access layer.
- Client: historical-load-on-scroll points at the archive API; stitch hot + cold ranges.
- Verify: scrolling past the hot window loads old messages from PostgreSQL; recent messages stay real-time.

### Phase 4 — Migration tooling (days 21–25)
- **Entry gate:** resolve open decision 1 (id allocation) — check upstream first; otherwise implement the counter-table default.
- `archive_restore` reducer; worker rebuild mode; documented migration procedure.
- Verify: perform a destructive test schema change → `--delete-data` → rebuild from PostgreSQL → primary keys, timestamps, and relationships preserved; only the hot set reloaded.

### Phase 5 — Edge cases & hardening (days 26–30)
- Edit/delete-through path for evicted messages; worker offline/reconnect/reconcile hardening; replication-lag monitoring.
- Verify: editing/deleting an evicted message reflects in PostgreSQL and to clients; worker reconciles correctly after extended downtime.
- **Phase 1 carry-over (address with monitoring/hardening):**
  - `replication_state.row_count` / watermarks update only on (re)subscribe-time reconcile, not on steady-state writes — so the table lags between resubscribes. Fold real lag metrics in here (it's observability, not a cursor).
  - Worker has no healthcheck and (in dev) auto-issues + persists its own token; for prod prefer an explicit `ARCHIVE_WORKER_TOKEN` so the service identity is reproducible, and add a container healthcheck.
- **Not yet wired (Phase 1 completeness, do when deploying the tier):** the `archive-worker` exists only in `docker-compose.dev.yml`; add it (+ `ARCHIVE_DATABASE_URL`) to the prod compose files and `.env.production.*.example`, give it a CI image build (`release.yml` / GHCR), and put it in a .NET solution so it isn't an orphan project.

> **Note:** the Phase 1 core-api crash-loop (unguarded archive migration) is **already fixed** — the archive is now strictly opt-in via `ARCHIVE_DATABASE_URL` and a failed/absent archive never takes down auth. See `DbInitializer.cs` / `Program.cs` / `ServiceOptions.cs`.

---

## Verification Checklist

1. **Mirror fidelity** — PostgreSQL matches SpacetimeDB row-for-row after a mix of inserts, edits, and deletes.
2. **Worker resilience** — kill and restart the worker mid-stream; it reconciles with no loss or duplicates.
3. **RAM bounded** — generate sustained message volume; SpacetimeDB RAM stays flat (eviction working).
4. **Hot set correctness** — each conversation holds exactly the last N messages in SpacetimeDB.
5. **Cold reads** — scroll past the hot window; old messages load from the archive API; recent stays live.
6. **Migration rebuild** — run a destructive test migration end-to-end; verify ids/timestamps/relationships preserved and only the hot set reloaded.
7. **Evicted-message edit/delete** — edit and delete an already-evicted message; changes reflect in PostgreSQL and to clients.
8. **No confusion of evict vs delete** — an evicted message is still in PostgreSQL; a soft-deleted channel message shows as redacted (`deleted = true`, content blanked) in both tiers; a DM deleted by both sides is gone from both tiers; a deleted channel/server leaves no messages in either tier (per open decision 2).
9. **Post-rebuild id allocation** — after a rebuild, sending new messages / creating servers & channels works with no id collisions (open decision 1 resolved).

---

## Relationship to the E2EE plan

- This plan is **E2EE-agnostic**: the worker mirrors and tiers opaque rows; it does not decrypt anything and is unaffected by whether `content` is plaintext or ciphertext.
- **Order: plan 2 of 4** — after `1-control-panel.md`, before `3-e2ee.md`. When the E2EE plan lands, messages become ciphertext blobs and the cold archive holds ciphertext just as happily as plaintext — no changes to the tiering machinery.
- **Hand-off note for the E2EE/efficiency work:** eviction ≠ deletion. A message absent from SpacetimeDB without a deletion signal may simply be evicted. The E2EE plan's tombstones/deletion handling must treat "row absent, no tombstone" as "possibly evicted, fetch from archive," not "deleted."

---

## Effort

~4.5–5.5 weeks (one developer): worker ~2 weeks · eviction + reducers ~1 week · archive API + client ~1 week · migration tooling ~1 week · edge cases + hardening ~0.5–1 week. Excludes the .NET core-api rebuild — see `1-control-panel.md`.
