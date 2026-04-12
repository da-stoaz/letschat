import type { DbConnection } from '../../generated'
import {
  mapUser,
  mapServer,
  mapServerMember,
  mapInvite,
  isInviteActive,
  mapDmServerInvite,
  mapChannel,
  mapMessage,
  mapVoiceParticipant,
  mapFriend,
  mapBlock,
  mapDirectMessage,
  mapDmVoiceParticipant,
  mapPresenceState,
  mapTypingState,
  mapReadState,
  normalizeIdentity,
  sameIdentity,
  dmReadScopeKey,
} from './mappers'
import { useChannelsStore } from '../../stores/channelsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useDmStore } from '../../stores/dmStore'
import { useDmVoiceStore } from '../../stores/dmVoiceStore'
import { useDmVoiceSessionStore } from '../../stores/dmVoiceSessionStore'
import { useFriendsStore } from '../../stores/friendsStore'
import { useMembersStore } from '../../stores/membersStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { useSelfStore } from '../../stores/selfStore'
import { useServersStore } from '../../stores/serversStore'
import { useUiStore } from '../../stores/uiStore'
import { useUsersStore } from '../../stores/usersStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { useVoiceSessionStore } from '../../stores/voiceSessionStore'
import { usePresenceStore } from '../../stores/presenceStore'
import { useReadStore } from '../../stores/readStore'
import { useTypingStore } from '../../stores/typingStore'
import { useInvitesStore } from '../../stores/invitesStore'
import { useDmServerInvitesStore } from '../../stores/dmServerInvitesStore'
import type { ServerMemberWithUser } from '../../stores/membersStore'
import type { Channel, DirectMessage, Identity, User } from '../../types/domain'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function joinedServerIds(conn: DbConnection): Set<number> {
  const me = useConnectionStore.getState().identity
  if (!me) return new Set<number>()

  const joined = new Set<number>()
  for (const member of conn.db.server_member.iter()) {
    if (sameIdentity(toIdentityString(member.userIdentity), me)) {
      joined.add(toU64Number(member.serverId))
    }
  }
  return joined
}

// Local re-exports so sync functions don't need to call into mappers for these
function toIdentityString(value: unknown): Identity {
  if (value && typeof value === 'object' && 'toHexString' in value) {
    return (value as { toHexString(): string }).toHexString() as Identity
  }
  return String(value) as Identity
}

function toU64Number(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return Number(value)
}

function channelSectionSortValue(section: string | null): string {
  return (section ?? '').trim().toLowerCase()
}

function compareChannelsByLayout(left: Channel, right: Channel): number {
  const sectionDelta = channelSectionSortValue(left.section).localeCompare(channelSectionSortValue(right.section))
  if (sectionDelta !== 0) return sectionDelta

  const positionDelta = left.position - right.position
  if (positionDelta !== 0) return positionDelta

  return left.id - right.id
}

// ─── Unread state ─────────────────────────────────────────────────────────────

export function recomputeUnreadStateFromReadCursors(): void {
  const selfIdentity = useConnectionStore.getState().identity
  if (!selfIdentity) return

  const normalizedSelf = normalizeIdentity(selfIdentity)
  const readRowsByScope = useReadStore.getState().rowsByScope
  const messagesByChannel = useMessagesStore.getState().messagesByChannel
  const conversations = useDmStore.getState().conversations

  const unreadByChannel: Record<number, number> = {}
  for (const [channelIdKey, messages] of Object.entries(messagesByChannel)) {
    const channelId = Number(channelIdKey)
    if (!Number.isFinite(channelId)) continue
    const scopeKey = `channel:${channelId}`
    const lastReadAtMs = Date.parse(readRowsByScope[scopeKey]?.lastReadAt ?? '') || 0
    let unread = 0
    for (const message of messages) {
      if (normalizeIdentity(message.senderIdentity) === normalizedSelf) continue
      const sentAtMs = Date.parse(message.sentAt)
      if (Number.isFinite(sentAtMs) && sentAtMs > lastReadAtMs) unread += 1
    }
    unreadByChannel[channelId] = unread
  }

  const unreadByDmPartner: Record<Identity, number> = {}
  for (const [partnerIdentity, thread] of Object.entries(conversations)) {
    const scopeKey = dmReadScopeKey(selfIdentity, partnerIdentity as Identity)
    const lastReadAtMs = Date.parse(readRowsByScope[scopeKey]?.lastReadAt ?? '') || 0
    let unread = 0
    for (const message of thread) {
      if (normalizeIdentity(message.senderIdentity) === normalizedSelf) continue
      const sentAtMs = Date.parse(message.sentAt)
      if (Number.isFinite(sentAtMs) && sentAtMs > lastReadAtMs) unread += 1
    }
    unreadByDmPartner[normalizeIdentity(partnerIdentity) as Identity] = unread
  }

  useUiStore.setState((state) => {
    const sameChannel = JSON.stringify(state.unreadByChannel) === JSON.stringify(unreadByChannel)
    const sameDm = JSON.stringify(state.unreadByDmPartner) === JSON.stringify(unreadByDmPartner)
    if (sameChannel && sameDm) return state
    return { ...state, unreadByChannel, unreadByDmPartner }
  })
}

// ─── Sync functions ───────────────────────────────────────────────────────────

export function syncUsers(conn: DbConnection): User[] {
  const users = Array.from(conn.db.user.iter()).map(mapUser)
  useUsersStore.getState().setUsers(users)
  const selfIdentity = useConnectionStore.getState().identity

  if (selfIdentity) {
    useSelfStore.getState().setUser(users.find((user) => sameIdentity(user.identity, selfIdentity)) ?? null)
  }

  return users
}

export function syncServers(conn: DbConnection): void {
  const allowedServerIds = joinedServerIds(conn)
  const servers = Array.from(conn.db.server.iter())
    .map(mapServer)
    .filter((server) => allowedServerIds.has(server.id))
  useServersStore.getState().setServers(servers)
}

export function syncMembers(conn: DbConnection, users: User[] = syncUsers(conn)): void {
  const allowedServerIds = joinedServerIds(conn)
  const usersByIdentity = new Map(users.map((user) => [user.identity, user]))
  const members = Array.from(conn.db.server_member.iter())
    .map(mapServerMember)
    .filter((member) => allowedServerIds.has(member.serverId))
  const grouped = new Map<number, ServerMemberWithUser[]>()

  for (const member of members) {
    const byServer = grouped.get(member.serverId) ?? []
    byServer.push({ ...member, user: usersByIdentity.get(member.userIdentity) ?? null })
    grouped.set(member.serverId, byServer)
  }

  const store = useMembersStore.getState()
  const existingServerIds = Object.keys(store.membersByServer).map(Number)
  for (const serverId of existingServerIds) {
    if (!grouped.has(serverId)) {
      store.setServerMembers(serverId, [])
    }
  }

  for (const [serverId, rows] of grouped.entries()) {
    store.setServerMembers(serverId, rows)
  }
}

export function syncChannels(conn: DbConnection): void {
  const allowedServerIds = joinedServerIds(conn)
  const channels = Array.from(conn.db.channel.iter())
    .map(mapChannel)
    .filter((channel) => allowedServerIds.has(channel.serverId))
  const grouped = new Map<number, Channel[]>()
  for (const channel of channels) {
    const byServer = grouped.get(channel.serverId) ?? []
    byServer.push(channel)
    grouped.set(channel.serverId, byServer)
  }

  const store = useChannelsStore.getState()
  const existingServerIds = Object.keys(store.channelsByServer).map(Number)
  for (const serverId of existingServerIds) {
    if (!grouped.has(serverId)) {
      store.setServerChannels(serverId, [])
    }
  }

  for (const [serverId, rows] of grouped.entries()) {
    rows.sort(compareChannelsByLayout)
    store.setServerChannels(serverId, rows)
  }
}

export function syncMessages(conn: DbConnection): void {
  const messages = Array.from(conn.db.message.iter()).map(mapMessage)
  const grouped = new Map<number, typeof messages>()
  for (const message of messages) {
    const byChannel = grouped.get(message.channelId) ?? []
    byChannel.push(message)
    grouped.set(message.channelId, byChannel)
  }

  const store = useMessagesStore.getState()
  for (const [channelId, rows] of grouped.entries()) {
    rows.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    store.setChannelMessages(channelId, rows)
  }
}

export function syncVoiceParticipants(conn: DbConnection): void {
  const participants = Array.from(conn.db.voice_participant.iter()).map(mapVoiceParticipant)
  const grouped = new Map<number, typeof participants>()
  for (const participant of participants) {
    const byChannel = grouped.get(participant.channelId) ?? []
    byChannel.push(participant)
    grouped.set(participant.channelId, byChannel)
  }

  const store = useVoiceStore.getState()
  const existingChannelIds = Object.keys(store.participantsByChannel).map(Number)
  for (const channelId of existingChannelIds) {
    if (!grouped.has(channelId)) {
      store.setParticipants(channelId, [])
    }
  }

  for (const [channelId, rows] of grouped.entries()) {
    store.setParticipants(channelId, rows)
  }
}

export function syncFriends(conn: DbConnection): void {
  const me = useConnectionStore.getState().identity
  if (!me) {
    useFriendsStore.getState().setFriends([])
    useFriendsStore.getState().setBlocked([])
    return
  }

  const friends = Array.from(conn.db.my_friends.iter()).map(mapFriend)
  const blocked = Array.from(conn.db.my_blocks.iter()).map(mapBlock)

  useFriendsStore.getState().setFriends(friends)
  useFriendsStore.getState().setBlocked(blocked)
}

export function syncDirectMessages(conn: DbConnection): void {
  const directMessages = Array.from(conn.db.direct_message.iter()).map(mapDirectMessage)
  const me = useConnectionStore.getState().identity
  if (!me) return

  const grouped = new Map<Identity, DirectMessage[]>()
  for (const message of directMessages) {
    const partner = message.senderIdentity === me ? message.recipientIdentity : message.senderIdentity
    const thread = grouped.get(partner) ?? []
    thread.push(message)
    grouped.set(partner, thread)
  }

  const store = useDmStore.getState()
  for (const [partner, rows] of grouped.entries()) {
    rows.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    store.setConversation(partner, rows)
  }
}

export function syncDmVoiceParticipants(conn: DbConnection): void {
  const participants = Array.from(conn.db.my_dm_voice_participants.iter()).map(mapDmVoiceParticipant)
  const grouped = new Map<string, typeof participants>()
  for (const participant of participants) {
    const byRoom = grouped.get(participant.roomKey) ?? []
    byRoom.push(participant)
    grouped.set(participant.roomKey, byRoom)
  }

  const store = useDmVoiceStore.getState()
  const existingRoomKeys = Object.keys(store.participantsByRoom)
  for (const roomKey of existingRoomKeys) {
    if (!grouped.has(roomKey)) {
      store.setRoomParticipants(roomKey, [])
    }
  }

  for (const [roomKey, rows] of grouped.entries()) {
    store.setRoomParticipants(roomKey, rows)
  }
}

export function syncPresenceStates(conn: DbConnection): void {
  const rows = Array.from(conn.db.my_presence_states.iter()).map(mapPresenceState)
  usePresenceStore.getState().setPresenceRows(rows)
}

export function syncTypingStates(conn: DbConnection): void {
  const rows = Array.from(conn.db.my_typing_states.iter()).map(mapTypingState)
  useTypingStore.getState().setTypingRows(rows)
}

export function syncReadStates(conn: DbConnection): void {
  const rows = Array.from(conn.db.my_read_states.iter()).map(mapReadState)
  useReadStore.getState().setReadRows(rows)
}

export function syncInvites(conn: DbConnection): void {
  const allowedServerIds = joinedServerIds(conn)
  const inviteRows = Array.from(conn.db.invite.iter())
    .map(mapInvite)
    .filter((inv) => allowedServerIds.has(inv.serverId))
    .filter(isInviteActive)

  const store = useInvitesStore.getState()
  const grouped = new Map<number, typeof inviteRows>()
  for (const inv of inviteRows) {
    const byServer = grouped.get(inv.serverId) ?? []
    byServer.push(inv)
    grouped.set(inv.serverId, byServer)
  }
  for (const [serverId, rows] of grouped.entries()) {
    store.setServerInvites(serverId, rows)
  }

  const knownServerIds = new Set<number>([
    ...Object.keys(store.invitesByServer).map((key) => Number(key)),
    ...Array.from(allowedServerIds),
  ])

  for (const serverId of knownServerIds) {
    if (!grouped.has(serverId)) {
      store.setServerInvites(serverId, [])
    }
  }
}

export function syncDmServerInvites(conn: DbConnection): void {
  const rows = Array.from(conn.db.dm_server_invite.iter()).map(mapDmServerInvite)
  useDmServerInvitesStore.getState().setInvites(rows)
}

export function syncServerScopedState(conn: DbConnection, users: User[] = syncUsers(conn)): void {
  syncServers(conn)
  syncMembers(conn, users)
  syncChannels(conn)
  syncInvites(conn)
}

export function syncAll(conn: DbConnection): void {
  const users = syncUsers(conn)
  syncServerScopedState(conn, users)
  syncMessages(conn)
  syncVoiceParticipants(conn)
  syncFriends(conn)
  syncDirectMessages(conn)
  syncDmVoiceParticipants(conn)
  syncPresenceStates(conn)
  syncTypingStates(conn)
  syncReadStates(conn)
  syncDmServerInvites(conn)
  recomputeUnreadStateFromReadCursors()
}

// ─── Client state reset ───────────────────────────────────────────────────────

export function resetClientState(): void {
  const voiceSession = useVoiceSessionStore.getState()
  voiceSession.room?.disconnect()
  voiceSession.reset()
  const dmVoiceSession = useDmVoiceSessionStore.getState()
  dmVoiceSession.room?.disconnect()
  dmVoiceSession.reset()

  useConnectionStore.getState().setIdentity(null)
  useSelfStore.getState().setUser(null)
  useUsersStore.setState({ users: [], byIdentity: {} })

  useServersStore.setState({ servers: [], activeServerId: null })
  useChannelsStore.setState({ channelsByServer: {} })
  useMembersStore.setState({ membersByServer: {} })
  useMessagesStore.setState({ messagesByChannel: {} })
  useVoiceStore.setState({ participantsByChannel: {}, activeChannelId: null, localTracks: [] })
  useFriendsStore.setState({ friends: [], blocked: [] })
  useDmStore.setState({ conversations: {} })
  useDmVoiceStore.setState({ participantsByRoom: {} })
  useReadStore.getState().reset()
  useTypingStore.getState().reset()
  useInvitesStore.setState({ invitesByServer: {} })
  useDmServerInvitesStore.setState({ invites: [] })
  useUiStore.setState({
    activeChannelId: null,
    activeDmPartner: null,
    rightPanelOpen: false,
    modals: {},
    unreadByChannel: {},
    unreadByDmPartner: {},
    mutedChannels: {},
    mutedServers: {},
    mutedUsers: {},
  })
  usePresenceStore.getState().reset()
}
