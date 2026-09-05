import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Identity, Timestamp } from 'spacetimedb'
import { DbConnection } from '../../src/generated'
import { BASE, DB, createChannel, createServer, makeFriends, makeUser, type TestUser } from './harness'

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
  it('caps the subscription view at the recent window', async () => {
    const { rows, error } = await owner.sql('SELECT id FROM my_channel_messages')
    expect(error).toBeNull()
    expect(rows.length).toBe(WINDOW)
  })

  it('pages the rest back through the procedure', async () => {
    const first = await ownerConn.procedures.loadOlderChannelMessages({
      channelId: BigInt(channelId),
      before: Timestamp.now(),
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
      before: Timestamp.now(),
      limit: PAGE,
    })
    expect(page).toEqual([])
  })

  it('scopes DM paging to the caller’s own conversation', async () => {
    const partner = await makeUser('hist_dm')
    await makeFriends(owner, partner)
    await owner.call('send_direct_message', [partner.idArg, 'private one'])
    await partner.call('send_direct_message', [owner.idArg, 'private two'])

    const mine = await ownerConn.procedures.loadOlderDirectMessages({
      partner: new Identity(`0x${partner.identity}`),
      before: Timestamp.now(),
      limit: PAGE,
    })
    expect(mine.map((row) => row.content)).toEqual(['private one', 'private two'])

    // The outsider asking about the same partner sees their own (empty) thread,
    // never the one between owner and partner.
    const theirs = await outsiderConn.procedures.loadOlderDirectMessages({
      partner: new Identity(`0x${partner.identity}`),
      before: Timestamp.now(),
      limit: PAGE,
    })
    expect(theirs).toEqual([])
  })
})
