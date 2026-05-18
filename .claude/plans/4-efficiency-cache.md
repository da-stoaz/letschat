# Efficiency Plan: Client-Side Local Cache & Search — LetsChat

## Context

`2-storage-tiering.md` introduced a server-side hot/cold split: SpacetimeDB holds a bounded hot set (last N messages per conversation), a PostgreSQL archive holds full history, and clients load older history on scroll from the archive API. That solved server RAM, migration rigidity, and unbounded subscriptions.

What it did **not** address is the *client* experience:
- On every reconnect the client re-downloads the entire hot set from SpacetimeDB.
- There is no offline history — close the app and the view is empty until reconnect.
- Search only covers what is currently in memory.

This plan adds a **client-side local cache** (SQLite on the device) and **search** over it. It is a pure client-side performance/UX layer.

**Priority — the lowest-priority plan (4 of 4).** Storage-tiering already made the hot set small and bounded, so re-downloading it on reconnect is no longer expensive. The local cache is now an *optimization* (offline access, faster cold start, less bandwidth), not a necessity. Implement it after storage-tiering and E2EE — or skip it if those benefits aren't worth the cost.

**Relationship to E2EE:** E2EE-agnostic. The cache stores whatever the row's `content` is — plaintext today, ciphertext after the E2EE plan. Because E2EE uses long-lived per-conversation keys (not a ratchet), cached ciphertext decrypts on read any number of times.

---

## What moved out of this plan

The earlier version of this plan owned windowed subscriptions, incremental server-side sync, and historical-load-on-scroll. **Those are now provided by `2-storage-tiering.md`** and are removed here. The cursor/pagination problems, the temporary bounded subscriptions, the long-offline server reconciliation — all belong to storage-tiering now. This plan is *only* the client-side cache and search.

---

## Decisions

| Feature | Decision |
|---|---|
| Local cache | SQLite via `tauri-plugin-sql`, on the user's device |
| What is cached | The hot set + any archive ranges the user has scrolled to |
| Cache hydration | On reconnect, sync only the delta of the hot set into the cache |
| Deletion sync | Server-side tombstone tables, synced on reconnect (client-cache concern only) |
| Secure deletion | `journal_mode = DELETE` + `secure_delete = ON` |
| Search | In-memory first, then decrypt-on-read scan of the local cache |

---

## Local SQLite Schema

```sql
PRAGMA journal_mode = DELETE;   -- rollback journal, not WAL — see Secure Deletion
PRAGMA secure_delete = ON;      -- zero freed pages on disk

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY,
  channel_id  INTEGER NOT NULL,
  sender_identity TEXT NOT NULL,
  content     TEXT NOT NULL,        -- plaintext now; epoch ciphertext after E2EE
  epoch       INTEGER NOT NULL DEFAULT 0,
  sent_at     TEXT NOT NULL,
  edited_at   TEXT,
  encrypted   INTEGER NOT NULL DEFAULT 0,
  origin      TEXT NOT NULL DEFAULT 'hot'  -- 'hot' (live) | 'archive' (snapshot)
);

CREATE TABLE direct_messages (
  id          INTEGER PRIMARY KEY,
  conversation_id TEXT NOT NULL,     -- "dm:<idA>:<idB>", sorted pair
  sender_identity TEXT NOT NULL,
  recipient_identity TEXT NOT NULL,
  content     TEXT NOT NULL,
  epoch       INTEGER NOT NULL DEFAULT 0,
  sent_at     TEXT NOT NULL,
  edited_at   TEXT,
  encrypted   INTEGER NOT NULL DEFAULT 0,
  origin      TEXT NOT NULL DEFAULT 'hot'
);

CREATE TABLE sync_cursors (
  key             TEXT PRIMARY KEY,  -- 'messages' | 'direct_messages'
  last_sent_at    TEXT NOT NULL,
  last_edited_at  TEXT NOT NULL
);

CREATE INDEX idx_messages_channel_sent ON messages(channel_id, sent_at);
CREATE INDEX idx_dm_convo_sent         ON direct_messages(conversation_id, sent_at);
```

The `origin` column distinguishes live hot-set rows (kept current by the subscription) from archive-fetched snapshot rows (re-fetched on demand, not live-updated).

---

## Cache Sync

### On connect
1. The client subscribes to the hot set — storage-tiering already scopes the subscription to last-N-per-conversation.
2. Rows stream in; the client reads `sync_cursors` and writes only new/changed rows to the cache (`origin = 'hot'`).
3. UI renders from the cache immediately on next launch, before the subscription has even reconnected.

### Incremental delta
- Track the newest `sent_at` and `last_edited_at` per table in `sync_cursors`.
- On reconnect, only rows newer than the cursors are merged. Edits to **hot** messages stream live via the subscription and update the cache.
- Archive ranges (`origin = 'archive'`) the user has scrolled to are written to the cache too, but treated as **snapshots** — edits/deletes to archived messages (storage-tiering's write-through path) do not stream, so these ranges are re-fetched on demand rather than trusted indefinitely.

---

## Deletion Sync — Tombstones

> **Tombstones exist solely because of this client-side cache.** A connected client sees "row removed" live and needs nothing; storage-tiering itself needs no tombstones.
>
> When a hot message is deleted while a client is offline, on reconnect the row is simply absent from SpacetimeDB — and the client cannot tell "deleted" from "evicted" (storage-tiering: eviction ≠ deletion). A tombstone is the explicit "user deleted this" signal that lets the client purge its cache.

- `MessageTombstone` / `DirectMessageTombstone` — minimal rows: `message_id` + `deleted_at`, nothing else. `public` so clients subscribe to them.
- Written by the `delete_message` / `delete_direct_message` reducers after the hard delete.
- On reconnect the client syncs tombstones and securely deletes matching cache rows.
- Pruned after 90 days; a client offline longer reconciles its cache against the PostgreSQL archive on channel open (a message absent from the archive was deleted).

**Privacy note:** tombstones retain a small amount of server-side metadata — a message id existed and was deleted at time T. This is a deliberate, documented tradeoff, accepted in exchange for offline cache hygiene. They carry the minimum possible (id + timestamp).

**Schema footprint:** the two tombstone tables are this plan's only server-side change. They are additive (new tables) — non-destructive, no migration prompt.

---

## Secure Deletion from SQLite

A standard `DELETE` leaves content recoverable in freed pages. `secure_delete = ON` zeroes those pages; `journal_mode = DELETE` ensures no pre-image survives in a `-wal` file.

On receiving a tombstone:
```sql
UPDATE messages SET content = '' WHERE id = ?;  -- zero the value first
DELETE FROM messages WHERE id = ?;              -- secure_delete zeroes the freed page
```

This matters most after E2EE: the cache holds ciphertext, and under the long-lived-key model that ciphertext is decryptable later if a device key leaks — so zeroing deleted bytes has real value.

---

## Search

```
user types a query
→ search in-memory (Zustand) — already decrypted, instant
→ if more results wanted: scan the local SQLite cache
  → decrypt each candidate row on read, match
→ if deeper history wanted: trigger an archive load (storage-tiering), then re-search
```

Decrypt-on-read latency is proportional to rows scanned — acceptable on desktop. Full-text indexing of decrypted plaintext is intentionally not added (extra surface, out of scope).

---

## New / Modified Files

| Path | Change |
|---|---|
| `src/lib/localDb.ts` | New — SQLite client: open/PRAGMAs, read/write, tombstone sync, cursor management |
| `server/src/schema.rs` | Add `MessageTombstone`, `DirectMessageTombstone` tables |
| `server/src/reducers/messages.rs` | Write `MessageTombstone` in `delete_message` |
| `server/src/reducers/direct_messages.rs` | Write `DirectMessageTombstone` in `delete_direct_message` |
| `src-tauri/Cargo.toml` / `tauri.conf.json` | Add `tauri-plugin-sql` + SQL capability |
| `src/lib/spacetimedb/sync.ts` | Write hot-set deltas to the cache; subscribe to tombstone tables |
| `src/lib/spacetimedb/mappers.ts` | Hydrate from the cache; decrypt-on-read |

---

## Implementation Phases

### Phase 1 — Local SQLite foundation
- Add `tauri-plugin-sql`; open the DB on login with `journal_mode = DELETE` + `secure_delete = ON`; create the schema; `localDb.ts` read/write/delete helpers.

### Phase 2 — Cache hydration + incremental sync
- Write hot-set rows to the cache on sync; render from the cache on launch; track and apply `sent_at`/`edited_at` deltas.

### Phase 3 — Tombstones + secure deletion
- Add the tombstone tables; write them in the delete reducers; client purges the cache securely on tombstone receipt.
- Verify: delete a message while a client is offline → reconnect → cache row gone, bytes zeroed.

### Phase 4 — Search over the cache
- Extend search to scan the cache with decrypt-on-read; trigger archive loads for deeper history.

---

## Verification Checklist

1. **Cold start** — relaunch the app offline → cached hot set renders immediately.
2. **Incremental sync** — reconnect after others have posted → only the delta transfers into the cache.
3. **Edit sync** — edit a hot message → cache and UI update.
4. **Offline deletion** — delete a message while a client is offline → reconnect → cache row gone.
5. **Secure deletion** — inspect the SQLite file after a tombstone sync → deleted bytes are zeros, no `-wal` residue.
6. **Search** — search a term only present in cached-but-not-in-memory messages → returns results.
7. **Archive snapshot** — scroll to an archive range, edit one of those messages elsewhere → the range re-fetches rather than showing stale data.

---

## Effort

~2 weeks (one developer) — substantially smaller than the original plan, because windowed subscriptions, incremental server sync, and historical-load all moved to `2-storage-tiering.md`.
