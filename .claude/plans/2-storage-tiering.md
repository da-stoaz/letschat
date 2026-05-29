# Infrastructure Plan: Storage Tiering — SpacetimeDB Hot Tier + PostgreSQL Cold Archive

## Context

Two structural problems with the current SpacetimeDB setup must be fixed **before** the E2EE plan is implemented:

1. **Unbounded RAM.** SpacetimeDB holds all data in memory — verified against its docs: *"SpacetimeDB holds all data in memory… the practical limit is the available RAM on the host."* Larger-than-memory storage is roadmap-only, not shipped. Chat messages grow forever, so RAM grows forever.
2. **Rigid migrations.** Destructive SpacetimeDB schema changes (dropping a column, changing a type) require wiping table data — `spacetime publish` halts on a "requires deleting data" prompt.

This plan fixes both with one mechanism: a **PostgreSQL cold archive** kept as a continuous full replica of SpacetimeDB by a **replication worker**, plus **eviction** that keeps only a hot working set in SpacetimeDB.

This plan is **E2EE-agnostic**. It replicates and tiers opaque rows; it does not care whether `content` is plaintext (today) or ciphertext (after the E2EE plan). It is **plan 2 of 4** — implemented after `1-control-panel.md` and before `3-e2ee.md`.

**Backend language:** the backend services here are built in .NET Core. The replication worker is a .NET Worker Service. The core-api's rebuild in .NET on ASP.NET Core Identity is owned by `1-control-panel.md` and is a **prerequisite** for this plan's archive endpoints.

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

A new PostgreSQL service (added to Docker Compose). Holds a **full, current copy of every SpacetimeDB table** — the bounded tables (User, Server, Channel, ServerMember, …) so a rebuild can restore them, and the unbounded tables (Message, DirectMessage) which are the bulk.

- Tables mirror SpacetimeDB tables column-for-column, storing rows **verbatim**: original primary keys, timestamps, every field. No transformation in steady state.
- A `replication_state` table tracks the worker's progress / last-applied position.
- Indexes for the read pattern: `(channel_id, sent_at)` on messages, `(conversation_key, sent_at)` on direct messages (`conversation_key` = sorted identity pair).
- Capable of insert, update (edits), and delete (the mirror reflects all three).
- **Retention: forever.** This is the full archive. Only *user-initiated* deletes remove rows from PostgreSQL; eviction does not (eviction only removes from SpacetimeDB).

**The core-api moves to .NET and to this PostgreSQL instance.** The backend services are built in .NET Core. The core-api is rebuilt in .NET / ASP.NET Core on ASP.NET Core Identity — that rebuild is owned by `1-control-panel.md` and is a **prerequisite** for this plan's archive endpoints. Its data lives in a **separate database** (`auth`) on the same PostgreSQL server, distinct from the `archive` database. SQLite leaves the stack entirely. `auth` and `archive` stay as separate databases to isolate their very different workloads (auth: small, critical, frequent tiny reads; archive: large, append-mostly) while sharing one server to operate.

### 2. Replication worker (`archive-worker/`)

A new **.NET Worker Service** (a long-running .NET background-worker process). Authenticates to SpacetimeDB as a dedicated **service identity** with elevated rights.

- **Initial backfill**: on first run, read all rows from all tables, upsert into PostgreSQL by primary key (idempotent).
- **Steady state**: subscribe to all SpacetimeDB tables; on each insert/update/delete event, apply the corresponding upsert/delete to PostgreSQL.
- **Resilience**: on disconnect/restart, re-subscribe. SpacetimeDB delivers the current state of all subscribed rows on (re)subscribe; the worker upserts them. For deletions missed while offline, the worker reconciles **within the hot window only** (see below) — a row that is in PostgreSQL and within the hot window but absent from SpacetimeDB was user-deleted, and is deleted from PostgreSQL. Rows outside the hot window are assumed evicted, never "deleted".
- **Idempotent throughout** — every operation keyed by primary key, safe to replay.
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
- Recent messages still arrive via SpacetimeDB subscriptions, exactly as today. The client stitches the live (hot) range and the archive (cold) range.
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
- The core-api checks authorization (own message, etc.) and applies the change to the PostgreSQL row.
- **Tradeoff:** no SpacetimeDB broadcast, so other users viewing that same cold range do not see the change *live* — they see it on their next fetch of that range. Acceptable: cold ranges are already snapshots (standard infinite-scroll behavior), and a simultaneous second viewer of that exact old range is vanishingly rare.
- **Boundary race:** if a message is evicted between the user opening the editor and saving, the reducer call fails with "row not found"; the client falls back to the write-through endpoint.

(If a cold edit ever needed to feel live, the single message could be briefly restored into SpacetimeDB, edited via the normal reducer so it broadcasts, then re-evicted — a one-message special case, not the rejected general system.)

---

## New SpacetimeDB reducers (`server/src/reducers/archive.rs`)

All authorized **only** to the worker's service identity:

- `archive_evict(message_ids)` / `archive_evict_dm(ids)` — bulk hard-delete of aged rows from SpacetimeDB.
- `archive_restore(rows)` — verbatim insert during rebuild: explicit primary keys (auto-inc honored only for the sentinel `0`; explicit ids preserved), explicit timestamps, all fields; bypasses normal validation and permission logic.

**No changes to existing tables.** This plan adds reducers and a service identity only — it triggers no schema migration itself.

---

## New / modified files

| Path | Change |
|---|---|
| `archive-worker/` | New **.NET Worker Service**: backfill, steady-state CDC replication, eviction, rebuild mode |
| `cold-archive/migrations/` | PostgreSQL schema + migrations for the mirrored tables |
| `server/src/reducers/archive.rs` | New `archive_evict*` and `archive_restore` reducers |
| `server/src/lib.rs` | Register the archive reducers; provision the worker service identity |
| `core-api/` (.NET rebuild) | Rebuilt in .NET on ASP.NET Core Identity + PostgreSQL — **owned by `1-control-panel.md`**, prerequisite here |
| `core-api/` (archive) | New `/archive/*` read endpoints + evicted-message write-through (ASP.NET Core); cold-archive data access |
| `src/lib/spacetimedb/connection.ts` | Subscribe to the hot window (last N per conversation) instead of all messages |
| `src/lib/spacetimedb/sync.ts` | Historical-load path calls the archive API; stitch hot + cold ranges |
| `docker-compose.dev.yml` / prod compose files | Add the PostgreSQL service and the `archive-worker` service |

---

## Implementation Phases

### Phase 1 — Cold archive + replication worker (days 1–10)
- Stand up PostgreSQL; create the `archive` database + mirrored schema. (The `auth` database and the .NET core-api rebuild are a prerequisite — see `1-control-panel.md`.)
- `archive-worker`: a .NET Worker Service — service-identity auth to SpacetimeDB, initial backfill, steady-state CDC for insert/update/delete, idempotent upserts, reconnect/reconcile logic, `replication_state` tracking.
- Verify: PostgreSQL matches SpacetimeDB row-for-row after inserts, edits, and deletes; the worker survives kill/restart with no loss or duplication.

### Phase 2 — Eviction (days 11–15)
- Hotness rule (last N per conversation); `archive_evict*` reducers; worker eviction loop with copy-confirmed-before-delete ordering.
- Verify: SpacetimeDB RAM stays flat as message volume grows; the hot set is exactly last N per conversation.

### Phase 3 — Archive read API + client (days 16–20)
- core-api `/archive/*` endpoints with membership authorization; PostgreSQL access layer.
- Client: historical-load-on-scroll points at the archive API; stitch hot + cold ranges.
- Verify: scrolling past the hot window loads old messages from PostgreSQL; recent messages stay real-time.

### Phase 4 — Migration tooling (days 21–25)
- `archive_restore` reducer; worker rebuild mode; documented migration procedure.
- Verify: perform a destructive test schema change → `--delete-data` → rebuild from PostgreSQL → primary keys, timestamps, and relationships preserved; only the hot set reloaded.

### Phase 5 — Edge cases & hardening (days 26–30)
- Edit/delete-through path for evicted messages; worker offline/reconnect/reconcile hardening; replication-lag monitoring.
- Verify: editing/deleting an evicted message reflects in PostgreSQL and to clients; worker reconciles correctly after extended downtime.

---

## Verification Checklist

1. **Mirror fidelity** — PostgreSQL matches SpacetimeDB row-for-row after a mix of inserts, edits, and deletes.
2. **Worker resilience** — kill and restart the worker mid-stream; it reconciles with no loss or duplicates.
3. **RAM bounded** — generate sustained message volume; SpacetimeDB RAM stays flat (eviction working).
4. **Hot set correctness** — each conversation holds exactly the last N messages in SpacetimeDB.
5. **Cold reads** — scroll past the hot window; old messages load from the archive API; recent stays live.
6. **Migration rebuild** — run a destructive test migration end-to-end; verify ids/timestamps/relationships preserved and only the hot set reloaded.
7. **Evicted-message edit/delete** — edit and delete an already-evicted message; changes reflect in PostgreSQL and to clients.
8. **No confusion of evict vs delete** — an evicted message is still in PostgreSQL; a user-deleted message is gone from both.

---

## Relationship to the E2EE plan

- This plan is **E2EE-agnostic**: the worker mirrors and tiers opaque rows; it does not decrypt anything and is unaffected by whether `content` is plaintext or ciphertext.
- **Order: plan 2 of 4** — after `1-control-panel.md`, before `3-e2ee.md`. When the E2EE plan lands, messages become ciphertext blobs and the cold archive holds ciphertext just as happily as plaintext — no changes to the tiering machinery.
- **Hand-off note for the E2EE/efficiency work:** eviction ≠ deletion. A message absent from SpacetimeDB without a deletion signal may simply be evicted. The E2EE plan's tombstones/deletion handling must treat "row absent, no tombstone" as "possibly evicted, fetch from archive," not "deleted."

---

## Effort

~4.5–5.5 weeks (one developer): worker ~2 weeks · eviction + reducers ~1 week · archive API + client ~1 week · migration tooling ~1 week · edge cases + hardening ~0.5–1 week. Excludes the .NET core-api rebuild — see `1-control-panel.md`.
