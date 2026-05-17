# Efficiency Plan: Local Cache, Incremental Sync & Search — LetsChat

## Context
This plan addresses performance and usability, not security: reconnects currently re-download all messages from SpacetimeDB from scratch, there is no offline history, and search is limited to whatever is in memory. These become increasingly painful as servers grow.

**Dependency:** this plan assumes `plan-security-e2ee.md` is implemented. Messages at rest are ciphertext encrypted under a per-conversation epoch key. Because that model uses **long-lived symmetric keys** (not Signal's decrypt-once ratchet), the same ciphertext can be decrypted repeatedly on any authorized device — which is what makes a "store ciphertext, decrypt on read" cache viable. Under a ratchet-based design this plan would be impossible.

---

## Decisions

| Feature | Decision |
|---|---|
| Local message cache | SQLite via `tauri-plugin-sql`, stores epoch ciphertext |
| SpacetimeDB subscription scope | Windowed (last 7 days by default) |
| Incremental sync | Reconnect fetches only rows newer than local cursors (`sent_at` + `edited_at`) |
| Historical load | Local SQLite first; older pages fetched via a temporary bounded **subscription** |
| Deletion sync | Tombstone tables in SpacetimeDB, synced on reconnect |
| Long-offline reconciliation | Per-channel reconcile-on-open after tombstone retention expires |
| SQLite secure deletion | `journal_mode = DELETE` + `secure_delete = ON` |
| Search | In-memory first, then decrypt-on-read scan of local SQLite |

---

## Why This Is Separate from Security

The security plan is correct without any local cache: Zustand is in-memory and rebuilt from SpacetimeDB on every connect, and hard-deleted rows simply are not there. Server ciphertext is re-decryptable, so a device needs no local store for *correctness*.

A local SQLite cache is a pure **performance** layer. But introducing it creates new problems that the cache itself causes — not E2EE:
- Deleted messages must be purged from SQLite, even if the client was offline when the deletion happened.
- Edited messages must be updated in SQLite, including edits to messages outside the live window.
- The cache must track what it has and what is missing (cursors).
- Windowed subscriptions need a stable cursor mechanism.

These are solved below with tombstones and dual-cursor incremental sync.

---

## Tombstones — Developer Note

> **Tombstones exist solely because of this local SQLite cache.** Without a cache they would not exist.
>
> When a message is hard-deleted from SpacetimeDB while a client is offline, the client reconnects and the row is simply gone. It cannot distinguish "deleted" from "outside the subscription window," so the stale ciphertext row in SQLite would never be purged.
>
> A tombstone is a minimal SpacetimeDB row recording the **`message_id`** and **`deleted_at`** of a deleted message — nothing else. `message_id` is the globally-unique auto-inc primary key of `Message`, so it alone identifies the local SQLite row to delete (`DELETE FROM messages WHERE id = ?`). No `channel_id`, no sender, no content.
>
> **Privacy trade-off — must be acknowledged.** The security plan's hard delete leaves the server with *nothing*. A tombstone reintroduces a small amount of server-retained metadata: "a message with this id was deleted at this time." Volume and timing are inferable from the id sequence and `deleted_at`. This is the deliberate cost of having an offline-capable cache; it is accepted here and should be called out in any security review. Tombstones carry the minimum possible — id + timestamp — to keep that leak as small as possible.
>
> Tombstones are **not** for UI placeholders. A "[message deleted]" placeholder is itself a privacy signal. The UI treats tombstones strictly as cache-hygiene events.
>
> Tombstones are pruned after **90 days**. Clients offline longer fall back to per-channel reconcile-on-open (see *Long-Offline Reconciliation*).

---

## Problems to Solve

### 1. SpacetimeDB pagination is non-trivial
SpacetimeDB subscriptions are live views, not paginated queries. A `LIMIT` in a subscription is not stable. The practical approach is a **time-based cursor**: `WHERE sent_at > ?`. This works for incremental sync but cannot express "page N." Historical pages are loaded via a *temporary bounded subscription* (see *Sync Architecture*), not a reducer — SpacetimeDB reducers cannot return query results to the caller.

### 2. Deletion re-validation
Without tombstones the cache drifts: deleted messages linger and the cache contradicts the server. Tombstones fix this but require their own subscription and a sync step on reconnect.

### 3. Edit re-validation — the hard case
Editing a message does **not** change its `sent_at`, so an edited row that is outside the `WHERE sent_at > cursor` window is **not** re-streamed by a windowed subscription. Edits to in-window messages arrive automatically; edits to out-of-window messages do not.

**Fix: a second cursor on `edited_at`.** The windowed subscription filters on `(sent_at > sentCursor OR edited_at > editCursor)`. Both cursors are tracked in `sync_cursors`. An edit to any message — however old — bumps `edited_at` and therefore matches the subscription and re-streams to the client.

### 4. Search across history
In-memory search only covers the live window. Full-history search queries local SQLite, decrypting each candidate row on read. For a desktop app this latency is acceptable. Full-text indexing of decrypted plaintext is intentionally **not** added — see *Search*.

---

## SpacetimeDB Schema Additions

### Tombstone tables (added by this plan, not the security plan)

```rust
// Hard-deleted channel-message ids, so offline clients can purge their SQLite cache.
// id + timestamp only. Pruned after 90 days.
#[spacetimedb::table(accessor = message_tombstone, public)]
pub struct MessageTombstone {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub message_id: u64,
    pub deleted_at: Timestamp,
}

// Hard-deleted DM ids. DMs are delete-for-everyone, so a tombstone is written on every DM delete.
#[spacetimedb::table(accessor = direct_message_tombstone, public)]
pub struct DirectMessageTombstone {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub message_id: u64,
    pub deleted_at: Timestamp,
}
```

Both tables are `public` — clients must subscribe to them to purge their caches.

### Modified reducers
- `delete_message` — after the hard delete, insert a `MessageTombstone`
- `delete_direct_message` — after the hard delete, insert a `DirectMessageTombstone`
- A scheduled reducer prunes tombstones older than 90 days

---

## Local SQLite Schema

```sql
-- journal_mode = DELETE: a rollback journal, not WAL. WAL keeps pre-deletion page
-- images in the -wal file until checkpoint, which would defeat secure_delete.
-- secure_delete = ON: SQLite zeroes freed pages on disk.
PRAGMA journal_mode = DELETE;
PRAGMA secure_delete = ON;

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY,
  channel_id  INTEGER NOT NULL,
  sender_identity TEXT NOT NULL,
  content     TEXT NOT NULL,        -- epoch ciphertext (base64), decrypted on read
  epoch       INTEGER NOT NULL DEFAULT 0,
  sent_at     TEXT NOT NULL,
  edited_at   TEXT,
  encrypted   INTEGER NOT NULL DEFAULT 1
  -- no 'deleted' column: deleted rows are physically removed, not flagged
);

CREATE TABLE direct_messages (
  id          INTEGER PRIMARY KEY,
  conversation_id TEXT NOT NULL,     -- "dm:<idA>:<idB>", sorted pair
  sender_identity TEXT NOT NULL,
  recipient_identity TEXT NOT NULL,
  content     TEXT NOT NULL,         -- epoch ciphertext (base64)
  epoch       INTEGER NOT NULL DEFAULT 0,
  sent_at     TEXT NOT NULL,
  edited_at   TEXT,
  encrypted   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sync_cursors (
  key             TEXT PRIMARY KEY,  -- 'messages' | 'direct_messages'
  last_sent_at    TEXT NOT NULL,     -- newest sent_at seen
  last_edited_at  TEXT NOT NULL      -- newest edited_at seen
);

CREATE INDEX idx_messages_channel_sent ON messages(channel_id, sent_at);
CREATE INDEX idx_dm_convo_sent         ON direct_messages(conversation_id, sent_at);
```

`conversation_id` is stored on `direct_messages` so a DM thread is a single indexed range scan — the partner pair cannot be covered by one index across the `(sender, recipient)` OR-condition otherwise.

---

## Secure Deletion from SQLite

A standard `DELETE` leaves ciphertext recoverable in freed pages. With `secure_delete = ON` SQLite zeroes those pages; with `journal_mode = DELETE` no pre-image survives in a `-wal` file.

On receiving a tombstone:
```sql
UPDATE messages SET content = '' WHERE id = ?;  -- zero the value first
DELETE FROM messages WHERE id = ?;              -- secure_delete zeroes the freed page
```
The explicit `UPDATE` is belt-and-suspenders so no window exists between the two steps.

**Note on value:** because the security plan uses long-lived epoch keys, lingering ciphertext *is* decryptable later if a device key is ever compromised — so secure deletion has real value here (unlike under a ratchet, where old keys are already gone). The `journal_mode = DELETE` choice costs some write concurrency, acceptable for a single-process desktop app.

---

## Sync Architecture

### On first connect
1. Subscribe with a client-computed literal: `WHERE sent_at > <now − 7 days>` (SpacetimeDB subscriptions do not support `NOW()`; the client substitutes the timestamp).
2. Write received ciphertext rows to local SQLite.
3. Initialise `sync_cursors` with the newest `sent_at` / `edited_at` seen.

### On reconnect
1. Read `last_sent_at` and `last_edited_at` from `sync_cursors`.
2. Subscribe with `WHERE sent_at > last_sent_at OR edited_at > last_edited_at` — new messages **and** edits to any older message.
3. Merge delta rows into SQLite (`INSERT` new ids, `UPDATE content/edited_at` for existing ids).
4. Sync tombstone tables: for each new tombstone, securely delete the matching SQLite row.
5. Update both cursors.

### Historical load (scroll-up past the cache)
1. User scrolls above the oldest row in local SQLite.
2. Open a **temporary bounded subscription**: `SELECT * FROM message WHERE channel_id = ? AND sent_at < ? AND sent_at >= ?` (a fixed-size older window). Rows arrive via the normal subscription callback.
3. Write the batch to SQLite; drop the temporary subscription.
4. Decrypt and hydrate Zustand.

This replaces the non-existent `get_messages_before` reducer — SpacetimeDB reducers cannot return query results.

### Edit sync
Covered by the dual-cursor reconnect subscription (Problem 3). For edits that arrive on the *live* subscription while connected, SpacetimeDB streams a row-update event; the handler updates `content`/`edited_at` in SQLite and Zustand.

### Long-offline reconciliation
If a client has been offline longer than the 90-day tombstone retention, missed tombstones may have been pruned, so some deleted rows could linger in SQLite. Rather than a full re-download, reconciliation is **lazy and per-channel**: when the user next opens a channel, the client subscribes to that channel's 7-day window, diffs the live message ids against its cached ids for that window, and securely deletes any cached id no longer present on the server. Cost is bounded to channels the user actually visits.

---

## Search

```
user types a query
→ search Zustand (in-memory, already decrypted, instant)
→ if more results wanted: scan local SQLite content column
  → decrypt each candidate row on read (invoke crypto_decrypt_message), match
→ if deeper history wanted: trigger a historical load, then re-search
```

**Performance:** decrypt-on-read latency is proportional to rows scanned — acceptable on desktop. Full-text indexing would require storing decrypted plaintext; that is deliberately not done. (The local DB already holds decryptable ciphertext, so a plaintext FTS index is not a categorical security regression — but it is extra surface, and out of scope here.)

---

## New Files

| File | Purpose |
|---|---|
| `src/lib/localDb.ts` | SQLite client: open/close, PRAGMAs, read/write ciphertext, tombstone sync, dual-cursor management, per-channel reconciliation |

---

## Modified Files

| File | Change |
|---|---|
| `server/src/schema.rs` | Add `MessageTombstone`, `DirectMessageTombstone` tables |
| `server/src/reducers/messages.rs` | Write `MessageTombstone` in `delete_message` |
| `server/src/reducers/direct_messages.rs` | Write `DirectMessageTombstone` in `delete_direct_message` |
| `server/src/reducers/` | Scheduled reducer to prune tombstones >90 days |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-sql` |
| `src-tauri/tauri.conf.json` | SQL + filesystem capabilities |
| `src/lib/spacetimedb/connection.ts` | Windowed dual-cursor subscription; temporary bounded subscriptions for historical load |
| `src/lib/spacetimedb/sync.ts` | Write to SQLite on sync; subscribe to tombstone tables; per-channel reconciliation |
| `src/lib/spacetimedb/mappers.ts` | Decrypt-on-read when hydrating from SQLite (same async path as the live decrypt) |

---

## Implementation Phases

### Phase 1 — Local SQLite foundation
- Add `tauri-plugin-sql`; open the DB on login with `journal_mode = DELETE` + `secure_delete = ON`.
- Create the schema; `localDb.ts` insert/update/delete (zero-before-delete) and read helpers.

### Phase 2 — Full sync to SQLite (no windowing yet)
- On SpacetimeDB sync, write all received ciphertext rows to SQLite as a background write.
- Verify: SQLite holds ciphertext; UI still reads from Zustand unchanged.

### Phase 3 — Tombstone tables + secure deletion
- Add the tombstone tables; update the delete reducers; add the 90-day prune reducer.
- Client purges SQLite on tombstone receipt.
- Verify: delete a message while offline → reconnect → SQLite row gone, bytes zeroed (forensic check).

### Phase 4 — Windowed subscription + dual-cursor incremental sync
- Switch to the windowed subscription; track `last_sent_at` + `last_edited_at`.
- Verify with a network monitor: reconnect transfers only new rows; an edit to an old message still syncs.

### Phase 5 — Historical load on scroll
- Temporary bounded subscription on scroll-to-top; write batch to SQLite; hydrate Zustand.
- Verify: scrolling past the 7-day window loads and caches older messages.

### Phase 6 — Search + long-offline reconciliation
- Extend search to scan SQLite with decrypt-on-read.
- Implement per-channel reconcile-on-open.
- Verify: search finds messages older than the live window; a >90-day-offline client purges stale rows on channel open.

---

## Verification Checklist

1. **Reconnect delta** — disconnect, send from another client, reconnect → network monitor shows only new rows, not full history.
2. **Edit sync** — edit an old (out-of-window) message while offline → reconnect → SQLite + Zustand show the update (dual-cursor working).
3. **Offline deletion** — delete while offline → reconnect → SQLite row gone.
4. **Secure deletion** — after tombstone sync, inspect the SQLite file in a hex editor → deleted ciphertext bytes are zeros; no residue in any `-wal` file.
5. **Historical scroll** — scroll past the 7-day window → older messages load via bounded subscription, get cached, appear in UI.
6. **Search history** — search a term only in messages older than the window → returns results from SQLite.
7. **Long-offline reconcile** — simulate >90 days offline with pruned tombstones → open a channel → stale cached rows are purged.
8. **Re-decryptable cache** — close and reopen the app → cached ciphertext still decrypts (depends on the security plan's stable-key model).
