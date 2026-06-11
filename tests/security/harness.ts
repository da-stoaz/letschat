// Black-box test harness for the SpacetimeDB security boundary.
//
// Everything here talks to SpacetimeDB over the same HTTP surface a real client
// (or attacker) would: `POST /v1/identity` to mint an identity+token, `POST
// …/call/<reducer>` to act as that identity, and `POST …/sql` to read. Because
// reads run as the caller's identity, the `my_*` views scope to that identity
// and private base tables are simply invisible — which is exactly what we
// assert in the tests.

export const BASE = process.env.STDB_URL ?? 'http://127.0.0.1:4300'
export const DB = process.env.STDB_TEST_DB ?? 'letschattest'

// SpacetimeDB's `/call` rejects a Content-Type that carries a charset, so we
// send a bare `application/json`.
const JSON_HEADERS = { 'Content-Type': 'application/json' }

// ─── Reducer-arg encoders (SpacetimeDB algebraic JSON) ─────────────────────────

/** An enum variant with no payload, e.g. ChannelKind::Text -> `{ text: [] }`. */
export const variant = (name: string): Record<string, []> => ({ [name]: [] })
/** `Option::Some(v)` -> `{ some: v }`. */
export const some = (value: unknown): { some: unknown } => ({ some: value })
/** `Option::None` -> `{ none: [] }`. */
export const none = { none: [] as [] }

// ─── SQL result handling ───────────────────────────────────────────────────────

export interface SqlResult {
  columns: string[]
  rows: Record<string, unknown>[]
  /** Non-null when SpacetimeDB rejected the query (e.g. a private table). */
  error: string | null
}

async function runSql(query: string, token?: string): Promise<SqlResult> {
  const res = await fetch(`${BASE}/v1/database/${DB}/sql`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: query,
  })
  const text = await res.text()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { columns: [], rows: [], error: text.trim() }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { columns: [], rows: [], error: text.trim() }
  }

  const stmt = parsed[0] as { schema?: { elements?: { name?: { some?: string } }[] }; rows?: unknown[][] }
  if (!stmt.schema?.elements) {
    return { columns: [], rows: [], error: text.trim() }
  }
  const columns = stmt.schema.elements.map((el, i) => el.name?.some ?? `col${i}`)
  const rows = (stmt.rows ?? []).map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]])),
  )
  return { columns, rows, error: null }
}

/** An unauthenticated reader — what an anonymous attacker hitting `/sql` is. */
export const anon = { sql: (query: string): Promise<SqlResult> => runSql(query) }

// ─── Reducer errors ────────────────────────────────────────────────────────────

export class ReducerError extends Error {
  constructor(
    readonly reducer: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ReducerError'
  }
}

// ─── Test user ─────────────────────────────────────────────────────────────────

export class TestUser {
  constructor(
    readonly username: string,
    readonly identity: string,
    readonly token: string,
  ) {}

  /**
   * This identity encoded as a reducer argument. An `Identity` is a product of
   * a single U256 field, so it serialises as a one-element array of the hex
   * string: `["0x<hex>"]`.
   */
  get idArg(): [string] {
    return [`0x${this.identity}`]
  }

  /** Call a reducer as this user. Rejects (ReducerError) on a reducer `Err`. */
  async call(reducer: string, args: unknown[] = []): Promise<void> {
    const res = await fetch(`${BASE}/v1/database/${DB}/call/${reducer}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(args),
    })
    if (!res.ok) {
      throw new ReducerError(reducer, res.status, (await res.text()).trim())
    }
  }

  /** Read via `/sql` as this user (so `my_*` views scope to this identity). */
  sql(query: string): Promise<SqlResult> {
    return runSql(query, this.token)
  }
}

let nameCounter = 0

/** A fresh, schema-valid (2–32 chars, [a-z0-9_]) unique username. */
export function uniqueName(prefix = 'u'): string {
  nameCounter += 1
  const base = `${prefix}_${Date.now().toString(36)}_${nameCounter}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
  return base.slice(0, 32)
}

/** Mint a fresh identity and register a user for it. */
export async function makeUser(prefix = 'u'): Promise<TestUser> {
  const res = await fetch(`${BASE}/v1/identity`, { method: 'POST', headers: JSON_HEADERS })
  if (!res.ok) {
    throw new Error(`failed to mint identity: HTTP ${res.status}`)
  }
  const { identity, token } = (await res.json()) as { identity: string; token: string }
  const username = uniqueName(prefix)
  const user = new TestUser(username, identity, token)
  await user.call('register_user', [username, username])
  return user
}

// ─── Scenario builders ─────────────────────────────────────────────────────────

/** Create a space owned by `owner`; returns its id (read back from `my_servers`). */
export async function createServer(owner: TestUser, name = uniqueName('srv')): Promise<number> {
  await owner.call('create_server', [name])
  const { rows } = await owner.sql('SELECT id, name FROM my_servers')
  const row = rows.find((r) => r.name === name)
  if (!row) throw new Error(`created server "${name}" not visible in my_servers`)
  return Number(row.id)
}

/** Create a text channel in `serverId`; returns its id (read back from `my_channels`). */
export async function createChannel(
  owner: TestUser,
  serverId: number,
  name = uniqueName('chan'),
): Promise<number> {
  await owner.call('create_channel', [serverId, name, variant('text'), none, false])
  const { rows } = await owner.sql('SELECT id, name FROM my_channels')
  const row = rows.find((r) => r.name === name)
  if (!row) throw new Error(`created channel "${name}" not visible in my_channels`)
  return Number(row.id)
}

/** Send a friend request from `a` to `b` and have `b` accept it. */
export async function makeFriends(a: TestUser, b: TestUser): Promise<void> {
  await a.call('send_friend_request', [b.idArg])
  await b.call('accept_friend_request', [a.idArg])
}

/** Make a space joinable by anyone (discoverable + Everyone invite policy). */
export async function makeOpenJoinable(owner: TestUser, serverId: number): Promise<void> {
  await owner.call('set_server_invite_policy', [serverId, variant('everyone')])
  await owner.call('set_server_discovery', [serverId, true, none])
}
