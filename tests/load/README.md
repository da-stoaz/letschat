# Archive replication load test

Proves the cold-archive CDC worker keeps up with sustained message load with
**zero loss**. Backend-only by design — it drives the `send_message` reducer
directly (the real service path: `send_message` → gated `archive_*` view →
worker → PostgreSQL), not the UI.

## Prereqs
1. Dev services up (`bun run services:up`) and module published (`bun run spacetime:publish`).
2. Archive worker running with its identity registered (bootstrap once):
   - Start it: `cd archive-worker && dotnet run`
   - It logs its identity; register it as an admin:
     `spacetime call letschat set_archive_service_identity '["0x<identity>"]'`
     (or, as the module owner, seed the row directly:
     `spacetime sql letschat "INSERT INTO archive_service (id, service_identity) VALUES (1, 0x<identity>)"`)

## Run
```bash
STDB_TEST_DB=letschat bun tests/load/archive-throughput.ts
# tune: TOTAL, CONCURRENCY, LAG_TIMEOUT_MS
```

Purely additive: creates a throwaway user/server/channel, sends `TOTAL` messages,
asserts every one reached `archive_message`, then deletes the server (the worker
mirrors the cascade delete too). Exits non-zero on <100 msg/s or any loss.

## Verified result (2026-07-21, SpacetimeDB 2.5)
10,000 messages @ concurrency 64 → **142 msg/s, 10000/10000 replicated (zero loss),
0.1s catch-up lag**. Cascade-delete of all 10k also mirrored live.
