# SpacetimeDB security integration tests

These black-box tests pin the module's authorization and row-visibility
boundaries against a real SpacetimeDB process. They exercise the same HTTP
surfaces available to clients and attackers:

- `POST /v1/identity` creates an anonymous identity and token;
- `POST …/call/<reducer>` invokes a reducer as that identity;
- `POST …/sql` reads private tables or caller-scoped `my_*` views.

The suite publishes the module to the dedicated `letschattest` database with
`--delete-data` before it runs. `global-setup.ts` refuses to target `letschat`,
so ordinary development data is not erased.

The fresh test database starts without a pinned issuer. Most fixtures register
anonymous test identities in that bootstrap state; the anonymous-identity suite
then pins an issuer and verifies that foreign tokens can no longer register or
call account-gated reducers. This setup is deliberate and does not model the
normal production sign-in flow through `core-api`.

## Run

```bash
bun run services:up
bun run test:security
```

The `spacetime` CLI must be on `PATH`. Override the target only with another
throwaway database:

```bash
STDB_URL=http://127.0.0.1:4300 \
STDB_TEST_DB=letschattest \
bun run test:security
```

`bun run test:unit` runs only frontend unit tests. `bun run test` runs both
Vitest projects and therefore also requires SpacetimeDB.

## Coverage

| Area | What is pinned |
|---|---|
| Anonymous identity | account gate, trusted issuer, and first-admin bootstrap |
| Private tables/views | base-table privacy and per-caller `my_*` filtering |
| Membership | kick, ban, ownership transfer, DM friendship/block gates |
| Message history | bounded views and authorized pagination procedures |
| Pins | moderator-only mutation and scoped visibility |
| Voice | participant lifecycle and room admission state |
| Revocation | suspension and minimum token generation on reducers |
| Archive rebuild | worker-only restore boundary and collision-free post-rebuild ids |
| Social lookup | server-side friend lookup and invalid/self targets |

## Extend

[`harness.ts`](harness.ts) provides `mintIdentity()`, `makeUser()`,
`makeAdmin()`, `user.call()`, `user.sql()`, `anon.sql()`, and common scenario
builders. Keep authorization regression tests here instead of mocking the
module in frontend tests.

Reducer arguments use named algebraic JSON: enum `{ text: [] }`, option
`{ some: value }` / `{ none: [] }`, and identity `["0x<hex>"]`. `/sql` encodes
sum-type results positionally as `[variantIndex, payload]`.
