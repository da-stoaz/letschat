# Archive replication load test

`archive-throughput.ts` drives the real `send_message` reducer, waits for the
archive worker to mirror every row into PostgreSQL, and fails on data loss or
throughput below 100 messages/second. It measures the backend replication path,
not UI rendering.

## Safety and current limitation

This is a manual development benchmark, not part of Vitest or CI. It defaults
to the real development database name `letschat`, does not publish/reset a
module, and sends 10,000 messages. The script deletes its temporary server on a
successful run, but the generated user remains; an interrupted run can leave
the server and messages behind. Never point it at production.

The fixture currently creates its user through the anonymous security-test
harness. It therefore works only on a disposable module whose
`trusted_issuer` has not been pinned. A normal production-like database rejects
that registration by design. Before making this a repeatable CI benchmark, give
it a `core-api`-issued fixture account and an isolated archive database.

## Prerequisites

1. PostgreSQL and SpacetimeDB are running, and the target module is published.
2. `core-api` has run with `ARCHIVE_DATABASE_URL` configured so the archive
   schema exists.
3. The archive worker targets the same SpacetimeDB database and PostgreSQL
   archive database, and its identity is registered with
   `set_archive_service_identity`.
4. The target module is disposable and has no pinned trusted issuer, as noted
   above.

For the default development stack:

```bash
bun run services:up
bun run spacetime:publish
bun run core-api:dev
dotnet run --project archive-worker/ArchiveWorker.csproj
```

The worker logs its identity and the exact registration command. Register it
from an instance-admin identity before running the benchmark.

## Run

```bash
STDB_TEST_DB=letschat bun tests/load/archive-throughput.ts
```

Optional environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `TOTAL` | `10000` | Messages sent |
| `CONCURRENCY` | `64` | Parallel send loops |
| `LAG_TIMEOUT_MS` | `120000` | Maximum archive catch-up wait |
| `STDB_URL` | `http://127.0.0.1:4300` | SpacetimeDB HTTP endpoint |
| `STDB_TEST_DB` | `letschat` | Target module/database |
| `PG_CONTAINER` | `letschat-dev-postgres` | PostgreSQL container queried for results |
| `ARCHIVE_PG_DATABASE` | `archive` | PostgreSQL archive database |

## Historical baseline

On 2026-07-21 with SpacetimeDB 2.5, 10,000 messages at concurrency 64 reached
142 messages/second, replicated 10,000/10,000 rows, and caught up 0.1 seconds
after the final send. This is a historical comparison point, not a current
guarantee; the test has not been rerun since trusted-issuer enforcement landed.
