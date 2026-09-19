# Plan: Message storage tiering

> **Status (reviewed 2026-09-19): durability is implemented; eviction is
> deferred until measurements justify it.** This document describes only the
> remaining hot/cold split. The production archive and rebuild procedure are
> documented in [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

## Implemented baseline

- The archive worker mirrors all 14 durable SpacetimeDB tables into PostgreSQL.
- A destructive SpacetimeDB publish can be rebuilt from that archive. Restore
  reducers are worker-only, idempotent, preserve ids/timestamps, and reseed the
  module id counters.
- `my_channel_messages` and `my_direct_messages` already expose only the newest
  `RECENT_MESSAGE_WINDOW` rows per channel/conversation. The current value is
  **200**.
- The client already pages older history in pages of 100 through
  `load_older_channel_messages` and `load_older_direct_messages` and merges it
  into separate history stores.

The remaining problem is server memory: those views bound client subscriptions,
but every message still remains in SpacetimeDB and the paging procedures still
scan SpacetimeDB history. Client memory and reconnect traffic are bounded;
server memory is not.

## Trigger and scope

Do not implement eviction speculatively. Start it when production measurements
show either sustained SpacetimeDB memory growth approaching the host budget or
history paging scans causing material latency/CPU. Record the measurement and
chosen budget before enabling eviction.

When triggered:

- Tier only `Message` and `DirectMessage`. Keep all other durable tables hot.
- Keep the newest **200** rows per channel/DM conversation, using the existing
  `RECENT_MESSAGE_WINDOW` as the single product boundary.
- Keep pinned channel messages hot even when older than the window. Pins are
  already capped at 50 per channel, so this exception remains bounded.
- PostgreSQL becomes the authority for evicted rows; SpacetimeDB remains the
  authority for live state and authorization.
- Use two explicit deployment switches, both defaulting to `false`:
  `ARCHIVE_HISTORY_ENABLED` makes core-api/client use PostgreSQL history;
  `ARCHIVE_EVICTION_ENABLED` lets the worker create new cold rows. The second
  may never be enabled before the first.
- Extend `/.well-known/letschat.json` with `archiveHistory: boolean`. It is
  `true` exactly when `ARCHIVE_HISTORY_ENABLED=true`, even during a temporary
  archive outage: once cold rows exist, silently falling back to incomplete
  SpacetimeDB history would be worse than reporting the outage.

## Safety invariants

These must hold before the first row is evicted:

1. Never evict a row until its PostgreSQL upsert has committed.
2. Eviction is not deletion. A row removed from SpacetimeDB for tiering must
   remain in PostgreSQL.
3. A user/moderator deletion must not be resurrected by reconnect, reconcile,
   rebuild, or a retry.
4. Worker restarts and repeated batches are idempotent. A partial batch may
   leave a row in both tiers, never in neither tier.
5. Archive reads and writes fail closed when current authorization cannot be
   verified against SpacetimeDB.
6. New ids are greater than every hot **and cold** archived id.

The current worker violates invariant 2: every `archive_messages` /
`archive_direct_messages` `OnDelete` deletes the PostgreSQL row, and full
reconcile deletes every archive row missing upstream. That behavior must change
before eviction reducers exist.

## Phase 1 — Make replication eviction-aware

Add worker-owned operational metadata to the two PostgreSQL message tables:
`storage_tier` (`hot|evicting|cold`, default `hot`, enforced by a check
constraint) and nullable `eviction_batch_id`. SpacetimeDB rows do not carry
these fields. An upsert observed from SpacetimeDB makes the archive row hot
unless it is already part of an active eviction batch.

Add one small SpacetimeDB coordination table containing `batch_id`, message
kind, and the bounded id list. It holds only unacknowledged eviction receipts,
not history, and is not part of the PostgreSQL archive.

Evict in this order:

1. Select rows outside the newest-200 window from PostgreSQL; exclude pinned
   channel messages.
2. In one PostgreSQL transaction, assign a unique batch id and mark those rows
   `evicting` only after their archived content is present.
3. Call worker-only batch reducers (`archive_evict_messages` and
   `archive_evict_direct_messages`). In one SpacetimeDB transaction each reducer
   validates the complete batch, inserts its receipt, then deletes the rows.
   Existing receipts make a retry idempotent; an absent or newly pinned/hot id
   rejects the complete batch without partial deletion.
4. After observing the committed receipt, mark the matching PostgreSQL rows
   `cold`, commit, then call `archive_ack_eviction(batch_id)` to remove the
   receipt. Delete callbacks for `evicting|cold` rows never delete the archive
   row; callbacks for hot rows retain their current delete behavior.

On restart, resolve unfinished batches before selecting new work: receipt
present means finish `cold` + acknowledge; all rows still live means retry the
reducer; neither receipt nor live row means a real concurrent deletion, so
remove the archived row. A rejected reducer returns the batch to hot and runs a
targeted reconcile. This closes the crash window where eviction and a genuine
hard delete would otherwise be indistinguishable.

For message tables, reconnect reconciliation compares only rows marked hot.
Cold rows are intentionally absent upstream and must never be considered stale.
Normal hot-row deletes continue to remove/archive-update the corresponding row.

Also handle parent deletion explicitly: deleting a channel/server must remove
its cold channel messages and pins from PostgreSQL even if the worker was
offline during the live delete. This can be part of parent reconciliation; it
must not rely only on transient callbacks.

The reducers must verify the registered archive-service identity, accept small
bounded batches, and reject the whole batch when an id is absent, still inside
the hot window, or currently pinned. Do not expose a general hard-delete
reducer.

## Phase 2 — Serve cold history from core-api

Add authenticated `POST /archive/channel-messages` and
`POST /archive/direct-messages` endpoints matching the client’s existing
history contract. Every JSON request carries the existing `SessionToken` plus:

- channel: `channelId`, `beforeSentAt`, `beforeId`, `limit`
- DM: `partnerIdentity`, `beforeSentAt`, `beforeId`, `limit`
- maximum page size: 100
- order: oldest-to-newest within each returned page

Use `(sent_at, id)` as the cursor so equal timestamps cannot skip or duplicate
rows. The schema migration must add `(channel_id, sent_at, id)` and
`(conversation_key, sent_at, id)` indexes; the current two-column indexes do not
fully support that cursor.

The API first verifies that `beforeId` exists in the same archived
channel/conversation and that its stored timestamp matches `beforeSentAt`; use
the stored value for the query. For the first page this id is the oldest live
row; if its archive copy has not committed yet, return retryable `503` rather
than paging past a replication gap. Later cursors came from PostgreSQL and
therefore pass the same check naturally.

Before reading:

- validate the body token with the existing
  `TokenService.RequireAccountAsync` path, then mint the corresponding
  per-account SpacetimeDB token server-side; never put a session token in a URL;
- for channel history, verify the channel still exists and the caller is a
  current member of its server;
- for DMs, verify the caller is one party to the conversation;
- return no archive data if SpacetimeDB or the authorization check is
  unavailable.

Do not use archived membership as authorization: it may be stale after a user
leaves or is removed.

## Phase 3 — Reuse the existing client paging path

Keep the current live subscriptions and message stores. Replace only the
transport behind `loadOlderChannelMessages` and
`loadOlderDirectMessages` with the core-api archive endpoints once tiering is
enabled. PostgreSQL already contains hot and cold rows, so one archive cursor
can page continuously; the existing store merge-by-id handles overlap at the
hot/cold boundary.

Refresh the existing discovery document when connecting. Missing or false
`archiveHistory` keeps the current SpacetimeDB procedures for compatibility
with older/non-tiered servers. When it is true, use only the archive endpoints:
on network errors or `5xx`, keep the page retryable and show the outage; never
mark history exhausted or fall back to SpacetimeDB. `401/403` remain terminal
authorization failures.

Change `my_channel_messages` to return the union of the newest 200 messages and
all pinned messages in each visible channel, deduplicated by id. Keeping an old
pin hot without including it in this view would leave the client with the pin
metadata but no message content.

Archive responses must carry enough local metadata for the client to route an
edit/delete of a cold row to core-api. Recent live rows continue to use the
SpacetimeDB reducers.

## Phase 4 — Preserve cold-message mutations

Cold history must retain today’s behavior rather than becoming silently
read-only:

- channel edit: sender only;
- channel delete: sender or current server moderator/owner; retain the existing
  soft-deleted tombstone representation;
- DM edit: sender only and the same current friendship/block checks as the live
  reducer;
- DM delete: per-party flags, physically remove only after both parties delete.

Implement these as core-api archive mutations with current SpacetimeDB-backed
authorization. Updates apply directly to PostgreSQL because the row is no
longer hot. Reject a request if the row is hot, avoiding two write authorities
for the same row.

## Phase 5 — Make rebuild tier-aware

The current rebuild restores every archived message, which would undo tiering.
Change it to restore:

- all non-message durable tables;
- the newest 200 messages per channel and DM conversation;
- every pinned channel message outside that window.

Reseed message and DM id counters from the maximum id in the **entire** archive,
not only the subset restored into SpacetimeDB. The PostgreSQL cold set remains
unchanged throughout rebuild.

The current `archive_reseed_id_counters` scans only rows present in
SpacetimeDB, so it cannot provide those two maxima after a tiered rebuild. Add a
worker-only `archive_raise_message_id_counters(message_max,
direct_message_max)` reducer. The worker reads both `MAX(id)` values from the
full PostgreSQL tables, calls this reducer after restoring the hot subset, and
waits for its committed result before declaring rebuild complete. Existing
restore/reseed behavior remains unchanged for the other id-managed tables.

## Rollout

1. Ship the PostgreSQL migration, receipt table/reducers, eviction-aware
   reconciliation, tier-aware rebuild, archive endpoints, discovery capability,
   cold mutations, and client transport while both feature switches are false.
2. Verify archive/live parity and run a dry mode that reports candidate counts
   without deleting anything.
3. Enable `ARCHIVE_HISTORY_ENABLED` first and verify archive paging while every
   row still exists in SpacetimeDB. Then enable `ARCHIVE_EVICTION_ENABLED` for
   small batches on one worker instance. Monitor worker errors, archive counts,
   SpacetimeDB memory, history latency, and authorization failures.
4. Increase batch size only after reconnect/restart tests pass in
   production-like conditions.

Rollback is: set `ARCHIVE_EVICTION_ENABLED=false` to stop new batches but leave
`ARCHIVE_HISTORY_ENABLED=true`. Existing cold rows remain readable from
PostgreSQL; the rebuild path can rehydrate the hot subset or, in an emergency
maintenance operation, all history. Disable archive history only after a full
rehydration has been verified.

## Acceptance tests

- The newest 200 rows per conversation remain hot; row 201 becomes cold.
- Pinned rows remain hot, with at most the existing 50-row exception per
  channel, and their content is included in `my_channel_messages`.
- Killing the worker before/after the cold marker and before/after the reducer
  call loses no data and converges after restart.
- Reconnect reconciliation neither deletes cold rows nor resurrects deleted
  rows.
- Authorized scrolling crosses the tier boundary without gaps or duplicates;
  removed members and unrelated users receive no cold history.
- Equal-timestamp messages page deterministically.
- A server without `archiveHistory` uses SpacetimeDB paging; an archive-enabled
  server returns a retryable error rather than incomplete fallback history when
  PostgreSQL is unavailable.
- Cold channel/DM edit and delete semantics match the live reducers.
- Channel/server deletion cleans up cold dependent rows.
- Destructive rebuild restores only the intended hot set and allocates fresh
  ids above the full archive maximum.
- A load test demonstrates that SpacetimeDB message row count and memory settle
  near the configured hot-set bound.

## Non-goals

- No eviction of users, memberships, channels, pins, or other durable metadata.
- No client SQLite cache; that remains in
  [`4-efficiency-cache.md`](4-efficiency-cache.md).
- No E2EE design changes. Archived `content` can remain opaque when
  [`3-e2ee.md`](3-e2ee.md) lands.
- No second message-history implementation in the client; reuse the current
  pagination and stores.
