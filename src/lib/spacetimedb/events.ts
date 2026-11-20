import type { DbConnection } from '../../generated'
import {
  mapFriend,
  mapDirectMessage,
  mapMessage,
  mapDmServerInvite,
  mapServerMember,
  normalizeIdentity,
  sameIdentity,
} from './mappers'
import {
  syncFriends,
  syncDirectMessages,
  syncDmVoiceParticipants,
  syncPresenceStates,
  syncTypingStates,
  syncReadStates,
  syncInvites,
  syncDmServerInvites,
  syncDiscover,
  syncServerScopedState,
  syncServers,
  syncMembers,
  syncJoinRequests,
  syncChannels,
  syncMessages,
  syncPins,
  syncVoiceParticipants,
  syncUsers,
  recomputeUnreadStateFromReadCursors,
} from './sync'
import { notify, syncUnreadBadgeCount } from '../notifications'
import { useConnectionStore } from '../../stores/connectionStore'
import { useChannelsStore } from '../../stores/channelsStore'
import { useUiStore } from '../../stores/uiStore'
import { useUsersStore } from '../../stores/usersStore'
import { useSelfStore } from '../../stores/selfStore'
import type { DirectMessage, Identity, Message } from '../../types/domain'

// ─── Lookup helpers ───────────────────────────────────────────────────────────

function findServerIdByChannelId(channelId: number): number | null {
  const channelsByServer = useChannelsStore.getState().channelsByServer
  for (const [serverId, channels] of Object.entries(channelsByServer)) {
    if (channels.some((channel) => channel.id === channelId)) {
      return Number(serverId)
    }
  }
  return null
}

function findChannelNameById(channelId: number): string | null {
  const channelsByServer = useChannelsStore.getState().channelsByServer
  for (const channels of Object.values(channelsByServer)) {
    const channel = channels.find((row) => row.id === channelId)
    if (channel) return channel.name
  }
  return null
}

function findDisplayNameByIdentity(identity: Identity): string {
  const normalized = normalizeIdentity(identity)
  for (const user of Object.values(useUsersStore.getState().byIdentity)) {
    if (normalizeIdentity(user.identity) === normalized) {
      return user.displayName || user.username || identity.slice(0, 12)
    }
  }
  return identity.slice(0, 12)
}

function updateUnreadBadgeCount(): void {
  void syncUnreadBadgeCount()
}

// ─── System message parsing ───────────────────────────────────────────────────

function formatDurationLabel(durationSeconds: number): string {
  const total = Math.max(0, Math.round(durationSeconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function parseDmCallSystemMessage(
  content: string,
): { kind: 'call_started' | 'call_ended'; missed: boolean; durationLabel?: string } | null {
  const prefix = '__letschat_system__:'
  if (!content.startsWith(prefix)) return null

  const payloadText = content.slice(prefix.length)
  if (!payloadText.startsWith('{')) return null

  try {
    const payload = JSON.parse(payloadText) as { kind?: unknown; missed?: unknown; durationSeconds?: unknown }
    if (payload.kind !== 'call_started' && payload.kind !== 'call_ended') return null
    const missed = payload.missed === true
    const durationLabel =
      typeof payload.durationSeconds === 'number' && Number.isFinite(payload.durationSeconds) ?
        formatDurationLabel(payload.durationSeconds)
      : undefined
    return { kind: payload.kind, missed, durationLabel }
  } catch {
    return null
  }
}

function isMentionForSelf(content: string): boolean {
  const self = useSelfStore.getState().user
  if (!self) return false
  const normalizedContent = content.toLowerCase()
  const mentionNeedles = [`@${self.username.toLowerCase()}`, `@${self.displayName.toLowerCase()}`]
  return mentionNeedles.some((needle) => normalizedContent.includes(needle))
}

// ─── Exported event handlers ──────────────────────────────────────────────────

export function handleIncomingMessage(message: Message): void {
  const me = useConnectionStore.getState().identity
  if (!me || sameIdentity(message.senderIdentity, me)) return

  // Unread counts and the badge are recomputed once per coalesced flush, after
  // the message store has been rebuilt — doing it here would run per message
  // and read a store that has not caught up yet.
  const ui = useUiStore.getState()
  const channelId = message.channelId
  const serverId = findServerIdByChannelId(channelId)
  // The store holds every channel the client can read, so a channel missing
  // from it became visible in this very transaction (a join request approved,
  // a promotion into a moderator-only channel): its rows are history, not news.
  if (serverId === null) return
  const channelMuted = Boolean(ui.mutedChannels[channelId])
  const serverMuted = Boolean(ui.mutedServers[serverId])
  const userMuted = Boolean(ui.mutedUsers[normalizeIdentity(message.senderIdentity) as Identity])
  if (channelMuted || serverMuted || userMuted) return

  const senderLabel = findDisplayNameByIdentity(message.senderIdentity)
  const body = message.deleted ? '[message deleted]' : message.content
  const channelName = findChannelNameById(channelId) ?? undefined
  // A mention is still a message: with mention alerts off it notifies as one.
  const isMention = ui.notificationSettings.eventToggles.mentions && isMentionForSelf(body)
  const isActiveView = ui.activeChannelId === channelId

  void notify(isMention ? 'mention' : 'channel_message', {
    senderLabel,
    content: body,
    channelName,
    dedupeKey: `${message.id}`,
    suppressIfFocusedAndActive: isActiveView,
  })
}

export function handleIncomingDirectMessage(message: DirectMessage): void {
  const me = useConnectionStore.getState().identity
  if (!me) return

  const senderIsSelf = sameIdentity(message.senderIdentity, me)
  if (senderIsSelf) return

  // See handleIncomingMessage: unread + badge run once per coalesced flush.
  const partnerIdentity = message.senderIdentity
  const ui = useUiStore.getState()

  if (ui.mutedUsers[normalizeIdentity(partnerIdentity) as Identity]) return
  const isActiveView = ui.activeDmPartner !== null && sameIdentity(ui.activeDmPartner, partnerIdentity)
  const senderLabel = findDisplayNameByIdentity(partnerIdentity)
  const callSystem = parseDmCallSystemMessage(message.content)
  if (callSystem?.kind === 'call_ended' && callSystem.missed) {
    void notify('missed_call', {
      callerLabel: senderLabel,
      durationLabel: callSystem.durationLabel,
      dedupeKey: `${message.id}`,
      suppressIfFocusedAndActive: isActiveView,
    })
    return
  }
  if (callSystem?.kind === 'call_ended') {
    void notify('call_ended', {
      peerLabel: senderLabel,
      durationLabel: callSystem.durationLabel,
      dedupeKey: `${message.id}`,
      suppressIfFocusedAndActive: isActiveView,
    })
    return
  }
  void notify('direct_message', {
    senderLabel,
    content: message.content,
    dedupeKey: `${message.id}`,
    suppressIfFocusedAndActive: isActiveView,
  })
}

export function handleIncomingFriendRequest(username: string): void {
  void notify('friend_request', { username })
}

export function handleFriendAccepted(username: string): void {
  void notify('friend_accepted', { username })
}

// ─── Coalesced store refreshes ────────────────────────────────────────────────
//
// Every live-table handler used to rebuild a whole store synchronously, and the
// message handlers recomputed unread state on top of that — three full passes
// over the entire local history for every single incoming message. Steady-state
// chat therefore cost work proportional to all history held, per message.
//
// Instead each handler marks what went stale and one pass runs on a trailing
// timer, so a burst of N rows costs one rebuild rather than N. `syncAll` on the
// initial subscription apply is what populates everything up front, so nothing
// here needs to run before the connection is live.

/** Trailing-edge window. Long enough to absorb a burst, short enough to feel instant. */
const REFRESH_COALESCE_MS = 30

const pendingRefreshes = new Map<string, () => void>()
let unreadIsStale = false
let flushHandle: ReturnType<typeof setTimeout> | null = null

function flushRefreshes(): void {
  flushHandle = null
  const refreshes = [...pendingRefreshes.values()]
  pendingRefreshes.clear()
  const recomputeUnread = unreadIsStale
  unreadIsStale = false

  for (const refresh of refreshes) refresh()

  // After the stores, never before: unread counts are derived from them, and
  // the badge from the counts.
  if (recomputeUnread) {
    recomputeUnreadStateFromReadCursors()
    updateUnreadBadgeCount()
  }
}

/**
 * Mark a store stale. `key` dedupes, so ten rows landing in one burst schedule
 * one rebuild. `alsoUnread` additionally recomputes unread counts and the badge
 * once, after every pending rebuild has run.
 */
function scheduleRefresh(key: string, refresh: () => void, alsoUnread = false): void {
  pendingRefreshes.set(key, refresh)
  if (alsoUnread) unreadIsStale = true
  if (flushHandle !== null) return
  flushHandle = setTimeout(flushRefreshes, REFRESH_COALESCE_MS)
}

/**
 * Drop anything still pending. Called on teardown: a queued rebuild holds the
 * old `DbConnection` in its closure, and running it after a reconnect would
 * repopulate the stores from a dead connection's cache.
 */
export function cancelPendingRefreshes(): void {
  if (flushHandle !== null) clearTimeout(flushHandle)
  flushHandle = null
  pendingRefreshes.clear()
  unreadIsStale = false
}

// ─── Live table watcher ───────────────────────────────────────────────────────

type RowContext = { event: { tag: string } }

export function watchLiveTables(conn: DbConnection, isLive: () => boolean): void {
  // The initial snapshot is not a change: `syncAll` in `onApplied` handles it
  // once. The SDK emits `onApplied` BEFORE it dispatches the snapshot's
  // per-row `onInsert` callbacks, so `isLive()` is already true for every one
  // of them — they are told apart by their `SubscribeApplied` event tag.
  // Gating on `isLive()` alone re-notified the whole recent history on every
  // connect (a new device, a restart, a network blip).
  const changed = (ctx: RowContext) =>
    isLive() && (ctx.event.tag === 'Transaction' || ctx.event.tag === 'Reducer')
  // Only someone else's transaction is news. Rows our own reducer call made
  // visible (joining a space, accepting an invite, unblocking) are history.
  const news = (ctx: RowContext) => isLive() && ctx.event.tag === 'Transaction'

  const stale = (key: string, refresh: () => void, alsoUnread = false) => (ctx: RowContext) => {
    if (!changed(ctx)) return
    scheduleRefresh(key, refresh, alsoUnread)
  }

  const users = stale('users', () => syncUsers(conn))
  conn.db.my_visible_users.onInsert(users)
  conn.db.my_visible_users.onUpdate(users)

  const servers = stale('servers', () => {
    syncServers(conn)
    syncDiscover(conn)
  })
  conn.db.my_servers.onInsert(servers)
  conn.db.my_servers.onUpdate(servers)
  conn.db.my_servers.onDelete(servers)

  // Only the caller's OWN membership changes which spaces, channels, invites
  // and join requests are visible — every store filters by it. Anyone else
  // joining, leaving, or changing role touches the member list and nothing
  // more; rebuilding all six stores for that on every connected member was
  // BUG_ANALYSIS C7.
  const serverScoped = stale('serverScoped', () => syncServerScopedState(conn))
  const members = stale('members', () => syncMembers(conn))
  const memberChanged = (ctx: RowContext, row: Parameters<typeof mapServerMember>[0]) => {
    const me = useConnectionStore.getState().identity
    if (me && sameIdentity(mapServerMember(row).userIdentity, me)) serverScoped(ctx)
    else members(ctx)
  }
  conn.db.my_server_members.onInsert((ctx, row) => memberChanged(ctx, row))
  conn.db.my_server_members.onUpdate((ctx, _old, row) => memberChanged(ctx, row))
  conn.db.my_server_members.onDelete((ctx, row) => memberChanged(ctx, row))

  // Had no handler at all: new requests reached moderators, and a decline its
  // requester, only when some unrelated membership event re-synced everything.
  const joinRequests = stale('joinRequests', () => syncJoinRequests(conn))
  conn.db.my_join_requests.onInsert(joinRequests)
  conn.db.my_join_requests.onUpdate(joinRequests)
  conn.db.my_join_requests.onDelete(joinRequests)

  const discover = stale('discover', () => syncDiscover(conn))
  conn.db.discover_server_member_counts.onInsert(discover)
  conn.db.discover_server_member_counts.onUpdate(discover)
  conn.db.discover_server_member_counts.onDelete(discover)

  const channels = stale('channels', () => syncChannels(conn))
  conn.db.my_channels.onInsert(channels)
  conn.db.my_channels.onUpdate(channels)
  conn.db.my_channels.onDelete(channels)

  const voice = stale('voice', () => syncVoiceParticipants(conn))
  conn.db.my_voice_participants.onInsert(voice)
  conn.db.my_voice_participants.onUpdate(voice)
  conn.db.my_voice_participants.onDelete(voice)

  const friends = stale('friends', () => syncFriends(conn))
  conn.db.my_friends.onInsert((ctx, row) => {
    friends(ctx)
    if (!news(ctx)) return
    const me = useConnectionStore.getState().identity
    if (!me) return

    const mapped = mapFriend(row)
    if (mapped.status === 'Pending' && mapped.requestedBy !== me) {
      handleIncomingFriendRequest(findDisplayNameByIdentity(mapped.requestedBy))
    }
  })
  conn.db.my_friends.onUpdate((ctx, _oldRow, row) => {
    friends(ctx)
    if (!news(ctx)) return
    const me = useConnectionStore.getState().identity
    if (!me) return

    const mapped = mapFriend(row)
    if (mapped.status === 'Accepted' && mapped.requestedBy === me) {
      const otherIdentity = mapped.userA === me ? mapped.userB : mapped.userA
      handleFriendAccepted(findDisplayNameByIdentity(otherIdentity))
    }
  })
  conn.db.my_friends.onDelete(friends)
  conn.db.my_blocks.onInsert(friends)
  conn.db.my_blocks.onDelete(friends)

  const dms = stale('directMessages', () => syncDirectMessages(conn), true)
  conn.db.my_direct_messages.onInsert((ctx, row) => {
    dms(ctx)
    if (news(ctx)) handleIncomingDirectMessage(mapDirectMessage(row))
  })
  conn.db.my_direct_messages.onUpdate(dms)
  conn.db.my_direct_messages.onDelete(dms)

  const dmVoice = stale('dmVoice', () => syncDmVoiceParticipants(conn))
  conn.db.my_dm_voice_participants.onInsert(dmVoice)
  conn.db.my_dm_voice_participants.onUpdate(dmVoice)
  conn.db.my_dm_voice_participants.onDelete(dmVoice)

  // Presence heartbeats every 25s per visible user and typing fires per
  // keystroke, so these are the highest-frequency events in the app and the
  // ones coalescing helps most.
  const presence = stale('presence', () => syncPresenceStates(conn))
  conn.db.my_presence_states.onInsert(presence)
  conn.db.my_presence_states.onUpdate(presence)
  conn.db.my_presence_states.onDelete(presence)

  const typing = stale('typing', () => syncTypingStates(conn))
  conn.db.my_typing_states.onInsert(typing)
  conn.db.my_typing_states.onUpdate(typing)
  conn.db.my_typing_states.onDelete(typing)

  const readStates = stale('readStates', () => syncReadStates(conn), true)
  conn.db.my_read_states.onInsert(readStates)
  conn.db.my_read_states.onUpdate(readStates)
  conn.db.my_read_states.onDelete(readStates)

  const invites = stale('invites', () => syncInvites(conn))
  conn.db.my_invites.onInsert(invites)
  conn.db.my_invites.onUpdate(invites)
  conn.db.my_invites.onDelete(invites)

  const dmServerInvites = stale('dmServerInvites', () => syncDmServerInvites(conn))
  conn.db.my_dm_server_invites.onInsert((ctx, row) => {
    dmServerInvites(ctx)
    if (!news(ctx)) return
    const me = useConnectionStore.getState().identity
    if (!me) return
    const inv = mapDmServerInvite(row)
    if (inv.recipientIdentity && inv.recipientIdentity.toLowerCase() === me.toLowerCase()) {
      const senderName = findDisplayNameByIdentity(inv.senderIdentity)
      void notify('system', {
        title: 'Server Invite',
        body: `${senderName} invited you to join a server`,
        dedupeKey: `dm_invite:${inv.id}`,
      })
    }
  })
  conn.db.my_dm_server_invites.onUpdate(dmServerInvites)
  conn.db.my_dm_server_invites.onDelete(dmServerInvites)

  const messages = stale('messages', () => syncMessages(conn), true)
  conn.db.my_channel_messages.onInsert((ctx, row) => {
    messages(ctx)
    if (news(ctx)) handleIncomingMessage(mapMessage(row))
  })
  conn.db.my_channel_messages.onUpdate(messages)
  conn.db.my_channel_messages.onDelete(messages)

  const pins = stale('pins', () => syncPins(conn))
  conn.db.my_pinned_messages.onInsert(pins)
  conn.db.my_pinned_messages.onUpdate(pins)
  conn.db.my_pinned_messages.onDelete(pins)
}
