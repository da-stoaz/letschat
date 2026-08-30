import type { DbConnection } from '../../generated'
import {
  mapFriend,
  mapDirectMessage,
  mapMessage,
  mapDmServerInvite,
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
  syncServerScopedState,
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
  const channelMuted = Boolean(ui.mutedChannels[channelId])
  const serverMuted = serverId !== null ? Boolean(ui.mutedServers[serverId]) : false
  const userMuted = Boolean(ui.mutedUsers[normalizeIdentity(message.senderIdentity) as Identity])
  if (channelMuted || serverMuted || userMuted) return

  const senderLabel = findDisplayNameByIdentity(message.senderIdentity)
  const body = message.deleted ? '[message deleted]' : message.content
  const channelName = findChannelNameById(channelId) ?? undefined
  const isMention = isMentionForSelf(body)
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

export function watchLiveTables(conn: DbConnection, isLive: () => boolean): void {
  // Every handler bails before doing any work until the subscription has been
  // applied. During the initial apply `onInsert` fires once per row, and each
  // of those used to rebuild every store from the rows received so far — O(N²)
  // over the whole history, inside the same budget that has to cover connecting
  // at all. `syncAll` in `onApplied` does that work once instead.
  const stale = (key: string, refresh: () => void, alsoUnread = false) => () => {
    if (!isLive()) return
    scheduleRefresh(key, refresh, alsoUnread)
  }

  const users = stale('users', () => syncUsers(conn))
  conn.db.my_visible_users.onInsert(users)
  conn.db.my_visible_users.onUpdate(users)

  const serverScoped = stale('serverScoped', () => syncServerScopedState(conn))
  conn.db.my_servers.onInsert(serverScoped)
  conn.db.my_servers.onUpdate(serverScoped)
  conn.db.my_servers.onDelete(serverScoped)
  conn.db.my_server_members.onInsert(serverScoped)
  conn.db.my_server_members.onUpdate(serverScoped)
  conn.db.my_server_members.onDelete(serverScoped)

  const channels = stale('channels', () => syncChannels(conn))
  conn.db.my_channels.onInsert(channels)
  conn.db.my_channels.onUpdate(channels)
  conn.db.my_channels.onDelete(channels)

  const voice = stale('voice', () => syncVoiceParticipants(conn))
  conn.db.my_voice_participants.onInsert(voice)
  conn.db.my_voice_participants.onUpdate(voice)
  conn.db.my_voice_participants.onDelete(voice)

  const friends = stale('friends', () => syncFriends(conn))
  conn.db.my_friends.onInsert((_ctx, row) => {
    if (!isLive()) return
    scheduleRefresh('friends', () => syncFriends(conn))
    const me = useConnectionStore.getState().identity
    if (!me) return

    const mapped = mapFriend(row)
    if (mapped.status === 'Pending' && mapped.requestedBy !== me) {
      handleIncomingFriendRequest(findDisplayNameByIdentity(mapped.requestedBy))
    }
  })
  conn.db.my_friends.onUpdate((_ctx, _oldRow, row) => {
    if (!isLive()) return
    scheduleRefresh('friends', () => syncFriends(conn))
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
  conn.db.my_direct_messages.onInsert((_ctx, row) => {
    if (!isLive()) return
    scheduleRefresh('directMessages', () => syncDirectMessages(conn), true)
    handleIncomingDirectMessage(mapDirectMessage(row))
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
  conn.db.my_dm_server_invites.onInsert((_ctx, row) => {
    if (!isLive()) return
    scheduleRefresh('dmServerInvites', () => syncDmServerInvites(conn))
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
  conn.db.my_channel_messages.onInsert((_ctx, row) => {
    if (!isLive()) return
    scheduleRefresh('messages', () => syncMessages(conn), true)
    handleIncomingMessage(mapMessage(row))
  })
  conn.db.my_channel_messages.onUpdate(messages)
  conn.db.my_channel_messages.onDelete(messages)

  const pins = stale('pins', () => syncPins(conn))
  conn.db.my_pinned_messages.onInsert(pins)
  conn.db.my_pinned_messages.onUpdate(pins)
  conn.db.my_pinned_messages.onDelete(pins)
}
