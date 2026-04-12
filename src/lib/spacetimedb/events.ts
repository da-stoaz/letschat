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

  recomputeUnreadStateFromReadCursors()
  updateUnreadBadgeCount()

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

  recomputeUnreadStateFromReadCursors()
  updateUnreadBadgeCount()

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

// ─── Live table watcher ───────────────────────────────────────────────────────

export function watchLiveTables(conn: DbConnection, isLive: () => boolean): void {
  conn.db.user.onInsert(() => syncUsers(conn))
  conn.db.user.onUpdate(() => syncUsers(conn))
  conn.db.server.onInsert(() => syncServerScopedState(conn))
  conn.db.server.onUpdate(() => syncServerScopedState(conn))
  conn.db.server.onDelete(() => syncServerScopedState(conn))
  conn.db.server_member.onInsert(() => syncServerScopedState(conn))
  conn.db.server_member.onUpdate(() => syncServerScopedState(conn))
  conn.db.server_member.onDelete(() => syncServerScopedState(conn))
  conn.db.channel.onInsert(() => syncChannels(conn))
  conn.db.channel.onUpdate(() => syncChannels(conn))
  conn.db.channel.onDelete(() => syncChannels(conn))
  conn.db.voice_participant.onInsert(() => syncVoiceParticipants(conn))
  conn.db.voice_participant.onUpdate(() => syncVoiceParticipants(conn))
  conn.db.voice_participant.onDelete(() => syncVoiceParticipants(conn))
  conn.db.my_friends.onInsert((_ctx, row) => {
    syncFriends(conn)
    if (!isLive()) return
    const me = useConnectionStore.getState().identity
    if (!me) return

    const mapped = mapFriend(row)
    if (mapped.status === 'Pending' && mapped.requestedBy !== me) {
      handleIncomingFriendRequest(findDisplayNameByIdentity(mapped.requestedBy))
    }
  })
  conn.db.my_friends.onUpdate((_ctx, _oldRow, row) => {
    syncFriends(conn)
    if (!isLive()) return
    const me = useConnectionStore.getState().identity
    if (!me) return

    const mapped = mapFriend(row)
    if (mapped.status === 'Accepted' && mapped.requestedBy === me) {
      const otherIdentity = mapped.userA === me ? mapped.userB : mapped.userA
      handleFriendAccepted(findDisplayNameByIdentity(otherIdentity))
    }
  })
  conn.db.my_friends.onDelete(() => syncFriends(conn))
  conn.db.my_blocks.onInsert(() => syncFriends(conn))
  conn.db.my_blocks.onDelete(() => syncFriends(conn))
  conn.db.direct_message.onInsert((_ctx, row) => {
    syncDirectMessages(conn)
    recomputeUnreadStateFromReadCursors()
    if (!isLive()) return
    const message = mapDirectMessage(row)
    handleIncomingDirectMessage(message)
  })
  conn.db.direct_message.onUpdate(() => {
    syncDirectMessages(conn)
    recomputeUnreadStateFromReadCursors()
  })
  conn.db.direct_message.onDelete(() => {
    syncDirectMessages(conn)
    recomputeUnreadStateFromReadCursors()
  })
  conn.db.my_dm_voice_participants.onInsert(() => syncDmVoiceParticipants(conn))
  conn.db.my_dm_voice_participants.onUpdate(() => syncDmVoiceParticipants(conn))
  conn.db.my_dm_voice_participants.onDelete(() => syncDmVoiceParticipants(conn))
  conn.db.my_presence_states.onInsert(() => syncPresenceStates(conn))
  conn.db.my_presence_states.onUpdate(() => syncPresenceStates(conn))
  conn.db.my_presence_states.onDelete(() => syncPresenceStates(conn))
  conn.db.my_typing_states.onInsert(() => syncTypingStates(conn))
  conn.db.my_typing_states.onUpdate(() => syncTypingStates(conn))
  conn.db.my_typing_states.onDelete(() => syncTypingStates(conn))
  conn.db.my_read_states.onInsert(() => {
    syncReadStates(conn)
    recomputeUnreadStateFromReadCursors()
  })
  conn.db.my_read_states.onUpdate(() => {
    syncReadStates(conn)
    recomputeUnreadStateFromReadCursors()
  })
  conn.db.my_read_states.onDelete(() => {
    syncReadStates(conn)
    recomputeUnreadStateFromReadCursors()
  })
  conn.db.invite.onInsert(() => syncInvites(conn))
  conn.db.invite.onUpdate(() => syncInvites(conn))
  conn.db.invite.onDelete(() => syncInvites(conn))
  conn.db.dm_server_invite.onInsert((_ctx, row) => {
    syncDmServerInvites(conn)
    if (!isLive()) return
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
  conn.db.dm_server_invite.onUpdate(() => syncDmServerInvites(conn))
  conn.db.dm_server_invite.onDelete(() => syncDmServerInvites(conn))
  conn.db.message.onInsert((_ctx, row) => {
    syncMessages(conn)
    recomputeUnreadStateFromReadCursors()
    if (!isLive()) return

    const message = mapMessage(row)
    handleIncomingMessage(message)
  })
  conn.db.message.onUpdate(() => {
    syncMessages(conn)
    recomputeUnreadStateFromReadCursors()
  })
  conn.db.message.onDelete(() => {
    syncMessages(conn)
    recomputeUnreadStateFromReadCursors()
  })
}
