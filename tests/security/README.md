# SpacetimeDB security tests

Black-box integration tests that pin the table-visibility security model: private
tables must be unreadable to outsiders, and each `my_*` view must return only the
rows the calling identity is entitled to. If a future schema change re-exposes a
table or widens a view, one of these fails.

## How they work

They talk to a real SpacetimeDB instance over the same HTTP surface a client (or
an attacker) uses:

- `POST /v1/identity` mints a fresh identity + token (one per test user).
- `POST …/call/<reducer>` acts as that identity (set up servers, messages, DMs…).
- `POST …/sql` reads as that identity — so `my_*` views scope to it and private
  base tables are invisible.

`global-setup.ts` publishes the module to a **dedicated throwaway database**
(`letschattest`) with `--delete-data` before the suite runs. It hard-refuses to
target the real `letschat` database. The dev/prod data is never touched.

## Running

```bash
bun run services:up        # SpacetimeDB must be running on :4300
bun run test:security      # or: bun run test   (whole suite)
bun run test:watch         # watch mode
```

Override the target instance/database with env vars:

```bash
STDB_URL=http://127.0.0.1:4300 STDB_TEST_DB=letschattest bun run test:security
```

Requires the `spacetime` CLI on PATH (used by global setup to publish the module).

## Coverage

- **private-tables** — every content/secret/social-graph table rejects an
  anonymous `/sql` read; `system_settings` stays readable; scoped views return
  nothing to an anonymous caller.
- **visibility** — cross-user scoping for `my_channel_messages`,
  `my_direct_messages`, `my_servers` (member ∪ discoverable), `my_server_members`,
  `my_visible_users` (you can't enumerate strangers), and `my_bans` (moderators
  only).
- **friend-by-username** — `send_friend_request_by_username` resolves the
  username server-side and errors on unknown user / self.

## Extending

`harness.ts` has the building blocks: `makeUser()`, `user.call(reducer, args)`,
`user.sql(query)`, `anon.sql(query)`, plus scenario helpers (`createServer`,
`createChannel`, `makeFriends`, `makeOpenJoinable`) and the reducer-arg encoders
(`variant`, `some`, `none`, `user.idArg`). Two encoding notes worth knowing:

- Reducer **arguments** use named algebraic JSON: enum `{ text: [] }`, option
  `{ some: x }` / `{ none: [] }`, identity `["0x<hex>"]`.
- `/sql` **results** encode a sum type positionally as `[variantIndex, payload]`
  (e.g. `FriendStatus::Pending` → `[0, []]`).
