import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Identity, Timestamp } from 'spacetimedb'
import { DbConnection } from '../../src/generated'
import { BASE, DB, createChannel, createServer, makeAdmin, makeFriends, makeUser, none, ownerSql, some, timestamp, type TestUser } from './harness'

// `my_channel_messages` / `my_direct_messages` used to return every message of
// every channel of every space the caller belonged to, with no bound at all
// (BUG_ANALYSIS C3): the whole history, on every connect. They now carry only
// the newest RECENT_MESSAGE_WINDOW rows per channel / per conversation, and the
// `load_older_*` procedures page back beyond that.
//
// Two things have to hold, and both are asserted here: the window really is
// bounded, and the history below it is still reachable — but only by someone
// allowed to read that channel.

const WINDOW = 200
const EXTRA = 5
const TOTAL = WINDOW + EXTRA
const PAGE = 100

/**
 * "Everything so far" as a paging cursor. Not `Timestamp.now()`: `sent_at` is
 * stamped by the SpacetimeDB container's clock, and Docker Desktop's VM drifts
 * a few ms against the host, so a row written a moment ago can sit "after" the
 * host's now and be filtered out by `sent_at < before`. A cursor a minute out
 * asks the same question without depending on the two clocks agreeing. The
 * client never has this problem — it pages from the server's own `sentAt`.
 */
const newestPageCursor = () => Timestamp.fromDate(new Date(Date.now() + 60_000))

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

let owner: TestUser
let outsider: TestUser
let channelId: number
let ownerConn: DbConnection
let outsiderConn: DbConnection

beforeAll(async () => {
  owner = await makeUser('hist_owner')
  outsider = await makeUser('hist_out')

  const serverId = await createServer(owner)
  channelId = await createChannel(owner, serverId)

  // Sequential on purpose: the assertions below depend on send order, which is
  // what `sent_at` records.
  for (let i = 1; i <= TOTAL; i += 1) {
    await owner.call('send_message', [channelId, `msg-${i}`])
  }

  ownerConn = await connect(owner.token)
  outsiderConn = await connect(outsider.token)
})

afterAll(() => {
  ownerConn?.disconnect()
  outsiderConn?.disconnect()
})

describe('bounded message history', () => {
  it('resolves the intended invite before single-use consumption, independently of existing spaces', async () => {
    const target = await createServer(owner)
    await createServer(outsider)
    await createServer(outsider)
    await owner.call('create_invite', [target, none, some(1), []])
    const { rows } = await owner.sql('SELECT token, server_id FROM my_invites')
    const token = String(rows.find(row => Number(row.server_id) === target)!.token)
    expect(await outsiderConn.procedures.resolveInviteServer({ token })).toBe(BigInt(target))
    expect(await outsiderConn.procedures.resolveInviteServer({ token: 'unknown' })).toBeUndefined()
    await outsider.call('use_invite', [token])
    expect(await outsiderConn.procedures.resolveInviteServer({ token })).toBeUndefined()
    const joined = await outsider.sql('SELECT id FROM my_servers')
    expect(joined.rows.map(row => Number(row.id))).toContain(target)

    await owner.call('create_invite', [target, none, none, [owner.username]])
    const restricted = await owner.sql('SELECT token, server_id FROM my_invites')
    const restrictedToken = String(restricted.rows.find(row => Number(row.server_id) === target)!.token)
    expect(await outsiderConn.procedures.resolveInviteServer({ token: restrictedToken })).toBeUndefined()
  })
  it('caps the subscription view at the recent window', async () => {
    const { rows, error } = await owner.sql('SELECT id FROM my_channel_messages')
    expect(error).toBeNull()
    expect(rows.length).toBe(WINDOW)
  })

  it('pages the rest back through the procedure', async () => {
    const first = await ownerConn.procedures.loadOlderChannelMessages({
      channelId: BigInt(channelId),
      before: newestPageCursor(),
      limit: PAGE,
    })
    expect(first.length).toBe(PAGE)

    const second = await ownerConn.procedures.loadOlderChannelMessages({
      channelId: BigInt(channelId),
      before: first[0].sentAt,
      limit: PAGE,
    })
    expect(second.length).toBe(PAGE)

    // Everything below the window — the rows the view no longer carries.
    const third = await ownerConn.procedures.loadOlderChannelMessages({
      channelId: BigInt(channelId),
      before: second[0].sentAt,
      limit: PAGE,
    })
    expect(third.map((row) => row.content)).toEqual(
      Array.from({ length: EXTRA }, (_, i) => `msg-${i + 1}`),
    )

    // A short page is how the client learns there is nothing older.
    const fourth = await ownerConn.procedures.loadOlderChannelMessages({
      channelId: BigInt(channelId),
      before: third[0].sentAt,
      limit: PAGE,
    })
    expect(fourth).toEqual([])
  })

  it('gives a non-member nothing', async () => {
    const page = await outsiderConn.procedures.loadOlderChannelMessages({
      channelId: BigInt(channelId),
      before: newestPageCursor(),
      limit: PAGE,
    })
    expect(page).toEqual([])
    expect(await outsiderConn.procedures.loadOlderChannelMessagesPage({
      channelId: BigInt(channelId), before: newestPageCursor(), beforeId: 0n, limit: PAGE,
    })).toEqual([])
  })

  it('loads an older pin outside the subscription window only for a channel member', async () => {
    const history = await ownerConn.procedures.loadOlderChannelMessages({
      channelId: BigInt(channelId), before: newestPageCursor(), limit: TOTAL,
    })
    const oldest = await ownerConn.procedures.loadOlderChannelMessages({
      channelId: BigInt(channelId), before: history[0].sentAt, limit: PAGE,
    })
    await owner.call('pin_message', [channelId, Number(oldest[0].id)])
    const mine = await ownerConn.procedures.loadPinnedChannelMessages({ channelId: BigInt(channelId) })
    expect(mine.map(row => row.content)).toEqual(['msg-1'])
    expect(await outsiderConn.procedures.loadPinnedChannelMessages({ channelId: BigInt(channelId) })).toEqual([])
  })

  it('scopes DM paging to the caller’s own conversation', async () => {
    const partner = await makeUser('hist_dm')
    await makeFriends(owner, partner)
    await owner.call('send_direct_message', [partner.idArg, 'private one'])
    await partner.call('send_direct_message', [owner.idArg, 'private two'])

    const mine = await ownerConn.procedures.loadOlderDirectMessages({
      partner: new Identity(`0x${partner.identity}`),
      before: newestPageCursor(),
      limit: PAGE,
    })
    expect(mine.map((row) => row.content)).toEqual(['private one', 'private two'])

    // The outsider asking about the same partner sees their own (empty) thread,
    // never the one between owner and partner.
    const theirs = await outsiderConn.procedures.loadOlderDirectMessages({
      partner: new Identity(`0x${partner.identity}`),
      before: newestPageCursor(),
      limit: PAGE,
    })
    expect(theirs).toEqual([])
    expect(await outsiderConn.procedures.loadOlderDirectMessagesPage({
      partner: new Identity(`0x${partner.identity}`), before: newestPageCursor(), beforeId: 0n, limit: PAGE,
    })).toEqual([])
  })

  it.each(['channel', 'dm', 'self-dm'])('pages all %s rows across a tied subscription boundary and multiple tied pages', async kind => {
    // Archive restore gives deterministic microseconds and insertion order;
    // sending messages against a real clock cannot reliably create ties.
    const worker = await makeAdmin('cursor_fixture')
    await worker.call('set_archive_service_identity', [worker.idArg])
    const room = await createChannel(owner, await createServer(owner))
    const partner = kind === 'self-dm' ? owner : await makeUser('cursor_partner')
    const total = WINDOW + PAGE * 2 + 5
    const micros = 1_790_000_000_123_456
    let subscription: { unsubscribe(): void } | undefined
    try {
      // Allocate the first ID normally; restore advances the counter for the rest.
      if (kind === 'channel') await owner.call('send_message', [room, 'cursor seed'])
      else {
        const seedPartner = kind === 'self-dm' ? await makeUser('cursor_seed') : partner
        await makeFriends(owner, seedPartner)
        await owner.call('send_direct_message', [seedPartner.idArg, 'cursor seed'])
      }
      const view = kind === 'channel' ? 'my_channel_messages' : 'my_direct_messages'
      const seed = (await owner.sql(`SELECT id, content FROM ${view}`)).rows.find(row => row.content === 'cursor seed')!
      const firstId = Number(seed.id)
      const ids = Array.from({ length: total }, (_, index) => firstId + index)
      const rows = ids.map((id, index) => kind === 'channel'
        ? [id, room, owner.idArg, `cursor-${index}`, timestamp(micros - (index === 0 ? 1 : 0)), none, false]
        : [id, index % 2 ? partner.idArg : owner.idArg, index % 2 ? owner.idArg : partner.idArg,
          `cursor-${index}`, timestamp(micros - (index === 0 ? 1 : 0)), none, false, false])
      await worker.call(kind === 'channel' ? 'archive_restore_message' : 'archive_restore_direct_message', [rows.reverse()])
      subscription = await new Promise((resolve, reject) => {
        const handle = ownerConn.subscriptionBuilder().onApplied(() => resolve(handle))
          .onError((_ctx, error) => reject(error)).subscribe([`SELECT * FROM ${view}`])
      })
      const live = (kind === 'channel'
        ? [...ownerConn.db.my_channel_messages.iter()].filter(row => row.channelId === BigInt(room))
        : [...ownerConn.db.my_direct_messages.iter()].filter(row =>
          (row.senderIdentity.toHexString() === owner.identity && row.recipientIdentity.toHexString() === partner.identity)
          || (row.senderIdentity.toHexString() === partner.identity && row.recipientIdentity.toHexString() === owner.identity)))
        .sort((a, b) => Number(a.id - b.id))
      expect(live.map(row => Number(row.id))).toEqual(ids.slice(-WINDOW))
      let cursor = live[0]
      let loaded = live.map(row => Number(row.id))
      const sizes: number[] = []
      for (let attempt = 0; attempt < 5; attempt++) {
        const args = { before: cursor.sentAt, beforeId: cursor.id, limit: PAGE }
        const page = kind === 'channel'
          ? await ownerConn.procedures.loadOlderChannelMessagesPage({ channelId: BigInt(room), ...args })
          : await ownerConn.procedures.loadOlderDirectMessagesPage({ partner: new Identity(partner.identity), ...args })
        sizes.push(page.length)
        loaded = [...page.map(row => Number(row.id)), ...loaded]
        if (page.length < PAGE) break
        cursor = page[0]
      }
      expect(sizes).toEqual([PAGE, PAGE, 5])
      expect(loaded).toEqual(ids)
      expect(new Set(loaded).size).toBe(total)
    } finally {
      subscription?.unsubscribe()
      // These fixture restores must not leave the shared suite in restore mode.
      ownerSql('DELETE FROM storage_restore_fence')
      ownerSql(`UPDATE user SET is_admin = false WHERE identity = 0x${worker.identity}`)
    }
  })
})
