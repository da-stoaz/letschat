// The live-table watcher's cost model (BUG_ANALYSIS C1 + C2).
//
// Two properties are load-bearing and neither is visible by reading a handler:
//
//   C2 — nothing rebuilds a store until the subscription is live. The initial
//        apply fires onInsert once per row, and each of those used to rebuild
//        every store from the rows received so far, making the initial sync
//        O(N²) in the user's whole history — inside the same budget that also
//        has to cover connecting. `syncAll` in `onApplied` does it once instead.
//
//   C1 — once live, a burst of rows costs ONE rebuild, not one per row. Before,
//        every incoming message triggered a full re-map + re-sort of all
//        history, twice over, plus a full unread recompute on top.
//
// Both are assertions about how *often* something runs, so they are tested by
// counting calls rather than by checking any resulting state.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync', () => ({
  syncFriends: vi.fn(),
  syncDirectMessages: vi.fn(),
  syncDmVoiceParticipants: vi.fn(),
  syncPresenceStates: vi.fn(),
  syncTypingStates: vi.fn(),
  syncReadStates: vi.fn(),
  syncInvites: vi.fn(),
  syncDmServerInvites: vi.fn(),
  syncServerScopedState: vi.fn(),
  syncChannels: vi.fn(),
  syncMessages: vi.fn(),
  syncPins: vi.fn(),
  syncVoiceParticipants: vi.fn(),
  syncUsers: vi.fn(),
  recomputeUnreadStateFromReadCursors: vi.fn(),
}))

vi.mock('./mappers', () => ({
  mapFriend: vi.fn(() => ({ status: 'Pending', requestedBy: 'x', userA: 'a', userB: 'b' })),
  mapDirectMessage: vi.fn((row: unknown) => row),
  mapMessage: vi.fn((row: unknown) => row),
  mapDmServerInvite: vi.fn(() => ({ id: 1, senderIdentity: 's', recipientIdentity: 'r' })),
  normalizeIdentity: vi.fn((v: string) => v),
  sameIdentity: vi.fn(() => false),
}))

vi.mock('../notifications', () => ({
  notify: vi.fn(),
  syncUnreadBadgeCount: vi.fn(),
}))

import { cancelPendingRefreshes, watchLiveTables } from './events'
import { recomputeUnreadStateFromReadCursors, syncMessages, syncPresenceStates } from './sync'
import type { DbConnection } from '../../generated'

/** Callbacks the watcher registered, keyed by `<table>.<event>`. */
type Handlers = Map<string, (...args: unknown[]) => void>

/**
 * A `DbConnection` that records the handlers registered against it. A Proxy
 * stands in for `conn.db` so the fake does not have to enumerate the ~18 tables
 * the watcher subscribes to — and so it cannot silently drift when one is added.
 */
function fakeConnection(): { conn: DbConnection; handlers: Handlers } {
  const handlers: Handlers = new Map()
  const db = new Proxy(
    {},
    {
      get: (_target, table: string) => ({
        onInsert: (fn: (...a: unknown[]) => void) => handlers.set(`${table}.insert`, fn),
        onUpdate: (fn: (...a: unknown[]) => void) => handlers.set(`${table}.update`, fn),
        onDelete: (fn: (...a: unknown[]) => void) => handlers.set(`${table}.delete`, fn),
      }),
    },
  )
  return { conn: { db } as unknown as DbConnection, handlers }
}

describe('watchLiveTables', () => {
  beforeEach(() => {
    cancelPendingRefreshes()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it('rebuilds nothing until the subscription is live', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => false)

    // Stands in for the initial subscription apply: one onInsert per row.
    const insert = handlers.get('my_channel_messages.insert')!
    for (let i = 0; i < 500; i++) insert({}, { id: i })

    vi.runAllTimers()

    // The quadratic blow-up was exactly this being called once per row.
    expect(syncMessages).not.toHaveBeenCalled()
    expect(recomputeUnreadStateFromReadCursors).not.toHaveBeenCalled()
  })

  it('collapses a burst of messages into a single rebuild', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    const insert = handlers.get('my_channel_messages.insert')!
    for (let i = 0; i < 500; i++) insert({}, { id: i })

    // Nothing has run yet — the work is deferred, not merely deduped.
    expect(syncMessages).not.toHaveBeenCalled()

    vi.runAllTimers()

    expect(syncMessages).toHaveBeenCalledTimes(1)
    expect(recomputeUnreadStateFromReadCursors).toHaveBeenCalledTimes(1)
  })

  it('coalesces per table rather than globally', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_channel_messages.insert')!({}, { id: 1 })
    handlers.get('my_presence_states.update')!()
    handlers.get('my_presence_states.update')!()

    vi.runAllTimers()

    // A presence heartbeat must not cost a message-history rebuild, and vice
    // versa — but each table that did change still rebuilds exactly once.
    expect(syncMessages).toHaveBeenCalledTimes(1)
    expect(syncPresenceStates).toHaveBeenCalledTimes(1)
  })

  it('does not recompute unread for tables that cannot affect it', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_presence_states.update')!()
    vi.runAllTimers()

    // Presence beats every 25s per visible user; recomputing unread on each one
    // walks the entire history for nothing.
    expect(syncPresenceStates).toHaveBeenCalledTimes(1)
    expect(recomputeUnreadStateFromReadCursors).not.toHaveBeenCalled()
  })

  it('drops queued work on teardown', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_channel_messages.insert')!({}, { id: 1 })
    // A queued rebuild closes over the connection it was scheduled for; running
    // it after a reconnect would repopulate the stores from a dead cache.
    cancelPendingRefreshes()
    vi.runAllTimers()

    expect(syncMessages).not.toHaveBeenCalled()
  })
})
