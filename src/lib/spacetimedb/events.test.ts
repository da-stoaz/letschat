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
  syncServers: vi.fn(),
  syncMembers: vi.fn(),
  syncJoinRequests: vi.fn(),
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
  mapServerMember: vi.fn((row: { userIdentity: string }) => row),
  normalizeIdentity: vi.fn((v: string) => v),
  sameIdentity: vi.fn((a: string, b: string) => a === b),
}))

vi.mock('../notifications', () => ({
  notify: vi.fn(),
  syncUnreadBadgeCount: vi.fn(),
}))

import { cancelPendingRefreshes, watchLiveTables } from './events'
import { notify } from '../notifications'
import {
  recomputeUnreadStateFromReadCursors,
  syncDirectMessages,
  syncJoinRequests,
  syncMembers,
  syncMessages,
  syncPresenceStates,
  syncServerScopedState,
} from './sync'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSelfStore } from '../../stores/selfStore'
import { useChannelsStore } from '../../stores/channelsStore'
import { useUiStore } from '../../stores/uiStore'
import type { DbConnection } from '../../generated'

/** Event contexts as the SDK tags them. */
const snapshot = { event: { tag: 'SubscribeApplied' } }
const tx = { event: { tag: 'Transaction' } }
const ownReducer = { event: { tag: 'Reducer' } }

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
    useConnectionStore.setState({ identity: null })
    useChannelsStore.setState({ channelsByServer: { 7: [{ id: 1, name: 'general' } as never] } })
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  // The SDK emits onApplied (which flips isLive) BEFORE it dispatches the
  // snapshot's onInsert callbacks, so isLive is already true for those rows.
  it('treats the initial snapshot as neither a change nor news', () => {
    useConnectionStore.setState({ identity: 'me' })
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    for (let i = 0; i < 500; i++) {
      handlers.get('my_channel_messages.insert')!(snapshot, { id: i, senderIdentity: 'other', channelId: 1 })
      handlers.get('my_direct_messages.insert')!(snapshot, { id: i, senderIdentity: 'other', content: 'hi' })
    }
    handlers.get('my_friends.insert')!(snapshot, {})
    handlers.get('my_dm_server_invites.insert')!(snapshot, {})
    vi.runAllTimers()

    // Notifying here replayed the whole recent history on every connect.
    expect(notify).not.toHaveBeenCalled()
    // And rebuilding here redid what syncAll in onApplied already did.
    expect(syncMessages).not.toHaveBeenCalled()
    expect(recomputeUnreadStateFromReadCursors).not.toHaveBeenCalled()
  })

  it('notifies for someone else\'s transaction', () => {
    useConnectionStore.setState({ identity: 'me' })
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_direct_messages.insert')!(tx, { id: 1, senderIdentity: 'other', content: 'hi' })

    expect(notify).toHaveBeenCalledWith('direct_message', expect.objectContaining({ content: 'hi' }))
  })

  it('refreshes but does not notify for rows our own reducer made visible', () => {
    useConnectionStore.setState({ identity: 'me' })
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    // e.g. joining a space delivers its recent history in the join's own transaction.
    handlers.get('my_direct_messages.insert')!(ownReducer, { id: 1, senderIdentity: 'other', content: 'hi' })
    vi.runAllTimers()

    expect(notify).not.toHaveBeenCalled()
    expect(syncDirectMessages).toHaveBeenCalledTimes(1)
  })

  it('skips messages in a channel that only just became visible, and in muted spaces', () => {
    useConnectionStore.setState({ identity: 'me' })
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)
    const insert = handlers.get('my_channel_messages.insert')!

    // A join request approved by a moderator: the space's history arrives in
    // their transaction, before the channel store has caught up.
    insert(tx, { id: 1, senderIdentity: 'other', channelId: 99, content: 'old' })
    insert(tx, { id: 2, senderIdentity: 'other', channelId: 1, content: 'new' })
    useUiStore.setState({ mutedServers: { 7: true } })
    insert(tx, { id: 3, senderIdentity: 'other', channelId: 1, content: 'muted' })
    useUiStore.setState({ mutedServers: {} })

    expect(vi.mocked(notify).mock.calls.map((c) => (c[1] as { content: string }).content)).toEqual(['new'])
  })

  it('notifies a mention as a plain message when mention alerts are off', () => {
    useConnectionStore.setState({ identity: 'me' })
    useSelfStore.setState({ user: { username: 'me', displayName: 'Me' } as never })
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)
    const mention = { id: 1, senderIdentity: 'other', channelId: 1, content: 'hey @me' }

    handlers.get('my_channel_messages.insert')!(tx, mention)
    const ui = useUiStore.getState().notificationSettings
    useUiStore.setState({ notificationSettings: { ...ui, eventToggles: { ...ui.eventToggles, mentions: false } } })
    handlers.get('my_channel_messages.insert')!(tx, { ...mention, id: 2 })
    useUiStore.setState({ notificationSettings: ui })

    expect(vi.mocked(notify).mock.calls.map((c) => c[0])).toEqual(['mention', 'channel_message'])
  })

  it('does nothing after teardown', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => false)

    handlers.get('my_channel_messages.insert')!(tx, { id: 1, senderIdentity: 'other' })
    vi.runAllTimers()

    expect(syncMessages).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('collapses a burst of messages into a single rebuild', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    const insert = handlers.get('my_channel_messages.insert')!
    for (let i = 0; i < 500; i++) insert(tx, { id: i })

    // Nothing has run yet — the work is deferred, not merely deduped.
    expect(syncMessages).not.toHaveBeenCalled()

    vi.runAllTimers()

    expect(syncMessages).toHaveBeenCalledTimes(1)
    expect(recomputeUnreadStateFromReadCursors).toHaveBeenCalledTimes(1)
  })

  it('coalesces per table rather than globally', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_channel_messages.insert')!(tx, { id: 1 })
    handlers.get('my_presence_states.update')!(tx)
    handlers.get('my_presence_states.update')!(tx)

    vi.runAllTimers()

    // A presence heartbeat must not cost a message-history rebuild, and vice
    // versa — but each table that did change still rebuilds exactly once.
    expect(syncMessages).toHaveBeenCalledTimes(1)
    expect(syncPresenceStates).toHaveBeenCalledTimes(1)
  })

  it('does not recompute unread for tables that cannot affect it', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_presence_states.update')!(tx)
    vi.runAllTimers()

    // Presence beats every 25s per visible user; recomputing unread on each one
    // walks the entire history for nothing.
    expect(syncPresenceStates).toHaveBeenCalledTimes(1)
    expect(recomputeUnreadStateFromReadCursors).not.toHaveBeenCalled()
  })

  it('drops queued work on teardown', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_channel_messages.insert')!(tx, { id: 1 })
    // A queued rebuild closes over the connection it was scheduled for; running
    // it after a reconnect would repopulate the stores from a dead cache.
    cancelPendingRefreshes()
    vi.runAllTimers()

    expect(syncMessages).not.toHaveBeenCalled()
  })

  // BUG_ANALYSIS C7: someone else's membership change used to rebuild all six
  // space-scoped stores on every connected member of the space.
  it('rebuilds only the member list when someone else joins, leaves or changes role', () => {
    useConnectionStore.setState({ identity: 'me' })
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_server_members.insert')!(tx, { userIdentity: 'someone' })
    handlers.get('my_server_members.update')!(tx, { userIdentity: 'someone' }, { userIdentity: 'someone' })
    handlers.get('my_server_members.delete')!(tx, { userIdentity: 'someone' })
    vi.runAllTimers()

    expect(syncMembers).toHaveBeenCalledTimes(1)
    expect(syncServerScopedState).not.toHaveBeenCalled()
  })

  it('re-syncs every space-scoped store when the caller\'s own membership changes', () => {
    useConnectionStore.setState({ identity: 'me' })
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_server_members.insert')!(tx, { userIdentity: 'me' })
    vi.runAllTimers()

    expect(syncServerScopedState).toHaveBeenCalledTimes(1)
  })

  it('refreshes join requests when one arrives', () => {
    const { conn, handlers } = fakeConnection()
    watchLiveTables(conn, () => true)

    handlers.get('my_join_requests.insert')!(tx, {})
    vi.runAllTimers()

    expect(syncJoinRequests).toHaveBeenCalledTimes(1)
  })
})
