import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { DbConnection } from '../../src/generated'
import { BASE, DB, createServer, makeUser, ownerSql, type TestUser } from './harness'

// Voice presence is connection-scoped: rows record the SpacetimeDB connection
// that claimed them, and the module's `client_disconnected` lifecycle reducer
// sweeps a dying connection's rows. That server-side sweep is the single
// authority for stale-presence cleanup — the client no longer reconciles
// presence at all (the old client-side reconciler could flap join/leave
// against replicated lag). These tests exercise the real WebSocket lifecycle,
// not HTTP: a one-off HTTP /call connection dies as soon as the call returns,
// so HTTP-created presence is swept immediately — asserted here too, since the
// whole design hangs on that semantics.

const WS_URI = BASE.replace(/^http/, 'ws')

function connect(token: string): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(WS_URI)
      .withDatabaseName(DB)
      .withLightMode(false)
      .withCompression('none')
      .withToken(token)
      .onConnect(() => resolve(conn))
      .onConnectError((_conn, error) => reject(error))
      .build()
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 15_000)
  })
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return check()
}

function voiceRowCount(channelId: number): number {
  const out = ownerSql(`SELECT voice_key FROM voice_participant WHERE channel_id = ${channelId}`)
  return out.split('\n').filter((line) => /^\s*"/.test(line)).length
}

describe('voice presence — connection lifecycle', () => {
  let owner: TestUser
  let voiceChannelId: number
  let conn: DbConnection | null = null

  beforeAll(async () => {
    owner = await makeUser('vlc')
    await createServer(owner)
    // create_server seeds a General voice channel; find it via the owner's
    // view. Enums serialise as [variantIndex, []] — ChannelKind::Voice is 1.
    const { rows } = await owner.sql("SELECT id, kind FROM my_channels WHERE name = 'General'")
    const voiceRow = rows.find((r) => Array.isArray(r.kind) && r.kind[0] === 1)
    if (!voiceRow) throw new Error('seeded voice channel not found')
    voiceChannelId = Number(voiceRow.id)
  })

  afterAll(() => {
    conn?.disconnect()
  })

  it('a join over HTTP does not outlive its one-shot connection', async () => {
    await owner.call('join_voice_channel', [voiceChannelId])
    expect(
      await until(() => voiceRowCount(voiceChannelId) === 0, 5000),
      'HTTP-created presence row should be swept when its ephemeral connection dies',
    ).toBe(true)
  })

  it('presence persists while the WebSocket lives and is swept when it dies', async () => {
    conn = await connect(owner.token)
    conn.reducers.joinVoiceChannel({ channelId: BigInt(voiceChannelId) })

    expect(
      await until(() => voiceRowCount(voiceChannelId) === 1),
      'presence row should exist while the connection is alive',
    ).toBe(true)

    // Row must still be there seconds later — nothing reconciles it away.
    await new Promise((r) => setTimeout(r, 2000))
    expect(voiceRowCount(voiceChannelId)).toBe(1)

    conn.disconnect()
    conn = null

    expect(
      await until(() => voiceRowCount(voiceChannelId) === 0),
      'client_disconnected should sweep the dead connection’s presence row',
    ).toBe(true)
  })
})
