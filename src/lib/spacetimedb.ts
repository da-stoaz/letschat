import {
  Identity as SpacetimeIdentityClass,
  type Identity as SpacetimeIdentity,
  type Timestamp as SpacetimeTimestamp,
} from 'spacetimedb'
import { DbConnection, tables } from '../generated'
import { authServiceLogin, authServiceRefreshSpacetimeToken, clearStoredAuthSessionToken } from './authService'
import { useChannelsStore } from '../stores/channelsStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useDmStore } from '../stores/dmStore'
import { useDmVoiceStore } from '../stores/dmVoiceStore'
import { useDmVoiceSessionStore } from '../stores/dmVoiceSessionStore'
import { useFriendsStore } from '../stores/friendsStore'
import { useMembersStore } from '../stores/membersStore'
import { useMessagesStore } from '../stores/messagesStore'
import { useSelfStore } from '../stores/selfStore'
import { useServersStore } from '../stores/serversStore'
import { useUiStore } from '../stores/uiStore'
import { useUsersStore } from '../stores/usersStore'
import { useVoiceStore } from '../stores/voiceStore'
import { useVoiceSessionStore } from '../stores/voiceSessionStore'
import { usePresenceStore } from '../stores/presenceStore'
import { useReadStore } from '../stores/readStore'
import { useTypingStore } from '../stores/typingStore'
import { useInvitesStore } from '../stores/invitesStore'
import { useDmServerInvitesStore } from '../stores/dmServerInvitesStore'
import { clearBadgeCount, notify, syncUnreadBadgeCount } from './notifications'
import type { ServerMemberWithUser } from '../stores/membersStore'
import type {
  Block,
  Channel,
  ChannelKind,
  DirectMessage,
  DmInviteStatus,
  DmServerInvite,
  DmVoiceParticipant,
  Friend,
  FriendStatus,
  Identity,
  Invite,
  Message,
  PresenceState,
  ReadState,
  Role,
  ServerInvitePolicy,
  Server,
  ServerMember,
  TypingState,
  User,
  VoiceParticipant,
} from '../types/domain'

export type SpacetimeDBClient = {
  connection: DbConnection | null
  connect: () => Promise<void>
  disconnect: () => void
  call: <TArgs extends Record<string, unknown>>(reducer: string, args?: TArgs) => Promise<void>
}

const SPACETIMEDB_URI = (import.meta.env.VITE_SPACETIMEDB_URI as string | undefined) ?? 'ws://localhost:3000'
const SPACETIMEDB_DATABASE = (import.meta.env.VITE_SPACETIMEDB_DATABASE as string | undefined) ?? 'letschat'
const SPACETIMEDB_TOKEN_KEY = 'spacetimedb.auth_token'

let connection: DbConnection | null = null
let subscriptionHandle: { unsubscribe: () => void } | null = null
let connectPromise: Promise<void> | null = null
let liveEventsEnabled = false

function isPlaceholderEndpoint(url: string): boolean {
  return /yourdomain\.com/i.test(url)
}

function getConnectionErrorDetails(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim()
  }
  if (error && typeof error === 'object') {
    const maybeEvent = error as { type?: unknown; message?: unknown }
    if (typeof maybeEvent.message === 'string' && maybeEvent.message.trim().length > 0) {
      return maybeEvent.message.trim()
    }
    if (typeof maybeEvent.type === 'string' && maybeEvent.type.trim().length > 0) {
      return `${maybeEvent.type.trim()} event`
    }
  }
  const fallback = String(error)
  return fallback === '[object Event]' ? 'network event' : fallback
}

function joinedServerIds(conn: DbConnection): Set<number> {
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

function toIdentityString(value: unknown): Identity {
  if (value && typeof value === 'object' && 'toHexString' in value) {
    const hex = (value as SpacetimeIdentity).toHexString()
    return hex as Identity
  }

  return String(value) as Identity
}

function toU64Number(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return Number(value)
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as SpacetimeTimestamp).toDate().toISOString()
  }
  if (value instanceof Date) return value.toISOString()

  return new Date().toISOString()
}

function enumTag(value: unknown): string {
  if (value && typeof value === 'object' && 'tag' in value) {
    return String((value as { tag: string }).tag)
  }

  return String(value)
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

function normalizeIdentity(identity: Identity): string {
  return identity.trim().toLowerCase()
}

function sameIdentity(a: Identity, b: Identity): boolean {
  return normalizeIdentity(a) === normalizeIdentity(b)
}

type DbRow = Record<string, unknown>

function rowString(row: DbRow, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : String(value ?? '')
}

function rowNullableString(row: DbRow, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : value == null ? null : String(value)
}

function mapUser(row: DbRow): User {
  return {
    identity: toIdentityString(row.identity),
    username: rowString(row, 'username'),
    displayName: rowString(row, 'displayName'),
    avatarUrl: rowNullableString(row, 'avatarUrl'),
    createdAt: toIsoString(row.createdAt),
  }
}

function mapServer(row: DbRow): Server {
  return {
    id: toU64Number(row.id),
    name: rowString(row, 'name'),
    ownerIdentity: toIdentityString(row.ownerIdentity),
    invitePolicy: (enumTag(row.invitePolicy || 'ModeratorsOnly') as ServerInvitePolicy),
    iconUrl: rowNullableString(row, 'iconUrl'),
    createdAt: toIsoString(row.createdAt),
  }
}

function mapServerMember(row: DbRow): ServerMember {
  return {
    serverId: toU64Number(row.serverId),
    userIdentity: toIdentityString(row.userIdentity),
    role: enumTag(row.role) as Role,
    joinedAt: toIsoString(row.joinedAt),
    timeoutUntil: row.timeoutUntil ? toIsoString(row.timeoutUntil) : null,
  }
}

function mapInvite(row: DbRow): Invite {
  const rawAllowed = row.allowedUsernames
  return {
    token: rowString(row, 'token'),
    serverId: toU64Number(row.serverId),
    createdBy: toIdentityString(row.createdBy),
    expiresAt: toIsoString(row.expiresAt),
    maxUses: row.maxUses != null ? Number(row.maxUses) : null,
    useCount: Number(row.useCount ?? 0),
    allowedUsernames: Array.isArray(rawAllowed) ? (rawAllowed as string[]) : [],
  }
}

function isInviteActive(invite: Invite): boolean {
  const expired = Date.parse(invite.expiresAt) < Date.now()
  const exhausted = invite.maxUses != null && invite.useCount >= invite.maxUses
  return !expired && !exhausted
}

function mapDmServerInvite(row: DbRow): DmServerInvite {
  return {
    id: toU64Number(row.id),
    serverId: toU64Number(row.serverId),
    inviteToken: rowString(row, 'inviteToken'),
    senderIdentity: toIdentityString(row.senderIdentity),
    recipientIdentity: toIdentityString(row.recipientIdentity),
    status: enumTag(row.status) as DmInviteStatus,
    createdAt: toIsoString(row.createdAt),
  }
}

function mapChannel(row: DbRow): Channel {
  return {
    id: toU64Number(row.id),
    serverId: toU64Number(row.serverId),
    name: rowString(row, 'name'),
    kind: enumTag(row.kind) as ChannelKind,
    position: Number(row.position),
    moderatorOnly: Boolean(row.moderatorOnly),
  }
}

function mapMessage(row: DbRow): Message {
  return {
    id: toU64Number(row.id),
    channelId: toU64Number(row.channelId),
    senderIdentity: toIdentityString(row.senderIdentity),
    content: rowString(row, 'content'),
    sentAt: toIsoString(row.sentAt),
    editedAt: row.editedAt ? toIsoString(row.editedAt) : null,
    deleted: Boolean(row.deleted),
  }
}

function mapVoiceParticipant(row: DbRow): VoiceParticipant {
  return {
    channelId: toU64Number(row.channelId),
    userIdentity: toIdentityString(row.userIdentity),
    joinedAt: toIsoString(row.joinedAt),
    muted: Boolean(row.muted),
    deafened: Boolean(row.deafened),
    sharingScreen: Boolean(row.sharingScreen),
    sharingCamera: Boolean(row.sharingCamera),
  }
}

function mapFriend(row: DbRow): Friend {
  return {
    userA: toIdentityString(row.userA),
    userB: toIdentityString(row.userB),
    status: enumTag(row.status) as FriendStatus,
    requestedBy: toIdentityString(row.requestedBy),
    updatedAt: toIsoString(row.updatedAt),
  }
}

function mapBlock(row: DbRow): Block {
  return {
    blocker: toIdentityString(row.blocker),
    blocked: toIdentityString(row.blocked),
    createdAt: toIsoString(row.createdAt),
  }
}

function mapDirectMessage(row: DbRow): DirectMessage {
  return {
    id: toU64Number(row.id),
    senderIdentity: toIdentityString(row.senderIdentity),
    recipientIdentity: toIdentityString(row.recipientIdentity),
    content: rowString(row, 'content'),
    sentAt: toIsoString(row.sentAt),
    deletedBySender: Boolean(row.deletedBySender),
    deletedByRecipient: Boolean(row.deletedByRecipient),
  }
}

function mapDmVoiceParticipant(row: DbRow): DmVoiceParticipant {
  return {
    roomKey: rowString(row, 'roomKey'),
    userIdentity: toIdentityString(row.userIdentity),
    userA: toIdentityString(row.userA),
    userB: toIdentityString(row.userB),
    joinedAt: toIsoString(row.joinedAt),
    muted: Boolean(row.muted),
    deafened: Boolean(row.deafened),
    sharingScreen: Boolean(row.sharingScreen),
    sharingCamera: Boolean(row.sharingCamera),
  }
}

function mapPresenceState(row: DbRow): PresenceState {
  return {
    identity: toIdentityString(row.identity),
    online: Boolean(row.online),
    lastInteractionAt: toIsoString(row.lastInteractionAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

function mapTypingState(row: DbRow): TypingState {
  return {
    typingKey: rowString(row, 'typingKey'),
    scopeKey: rowString(row, 'scopeKey'),
    userIdentity: toIdentityString(row.userIdentity),
    updatedAt: toIsoString(row.updatedAt),
  }
}

function mapReadState(row: DbRow): ReadState {
  return {
    readKey: rowString(row, 'readKey'),
    scopeKey: rowString(row, 'scopeKey'),
    userIdentity: toIdentityString(row.userIdentity),
    lastReadAt: toIsoString(row.lastReadAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

function dmReadScopeKey(selfIdentity: Identity, otherIdentity: Identity): string {
  const a = normalizeIdentity(selfIdentity)
  const b = normalizeIdentity(otherIdentity)
  return a <= b ? `dm:${a}:${b}` : `dm:${b}:${a}`
}

function recomputeUnreadStateFromReadCursors(): void {
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

function syncUsers(conn: DbConnection): User[] {
  const users = Array.from(conn.db.user.iter()).map(mapUser)
  useUsersStore.getState().setUsers(users)
  const selfIdentity = useConnectionStore.getState().identity

  if (selfIdentity) {
    useSelfStore.getState().setUser(users.find((user) => sameIdentity(user.identity, selfIdentity)) ?? null)
  }

  return users
}

function syncServers(conn: DbConnection): void {
  const allowedServerIds = joinedServerIds(conn)
  const servers = Array.from(conn.db.server.iter())
    .map(mapServer)
    .filter((server) => allowedServerIds.has(server.id))
  useServersStore.getState().setServers(servers)
}

function syncMembers(conn: DbConnection, users: User[] = syncUsers(conn)): void {
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

function syncChannels(conn: DbConnection): void {
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
    rows.sort((a, b) => a.position - b.position)
    store.setServerChannels(serverId, rows)
  }
}

function syncMessages(conn: DbConnection): void {
  const messages = Array.from(conn.db.message.iter()).map(mapMessage)
  const grouped = new Map<number, Message[]>()
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

function syncVoiceParticipants(conn: DbConnection): void {
  const participants = Array.from(conn.db.voice_participant.iter()).map(mapVoiceParticipant)
  const grouped = new Map<number, VoiceParticipant[]>()
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

function syncFriends(conn: DbConnection): void {
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

function syncDirectMessages(conn: DbConnection): void {
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

function syncDmVoiceParticipants(conn: DbConnection): void {
  const participants = Array.from(conn.db.my_dm_voice_participants.iter()).map(mapDmVoiceParticipant)
  const grouped = new Map<string, DmVoiceParticipant[]>()
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

function syncPresenceStates(conn: DbConnection): void {
  const rows = Array.from(conn.db.my_presence_states.iter()).map(mapPresenceState)
  usePresenceStore.getState().setPresenceRows(rows)
}

function syncTypingStates(conn: DbConnection): void {
  const rows = Array.from(conn.db.my_typing_states.iter()).map(mapTypingState)
  useTypingStore.getState().setTypingRows(rows)
}

function syncReadStates(conn: DbConnection): void {
  const rows = Array.from(conn.db.my_read_states.iter()).map(mapReadState)
  useReadStore.getState().setReadRows(rows)
}

function syncInvites(conn: DbConnection): void {
  const allowedServerIds = joinedServerIds(conn)
  const inviteRows: Invite[] = Array.from(conn.db.invite.iter())
    .map(mapInvite)
    .filter((inv) => allowedServerIds.has(inv.serverId))
    .filter(isInviteActive)

  const store = useInvitesStore.getState()
  const grouped = new Map<number, Invite[]>()
  for (const inv of inviteRows) {
    const byServer = grouped.get(inv.serverId) ?? []
    byServer.push(inv)
    grouped.set(inv.serverId, byServer)
  }
  for (const [serverId, rows] of grouped.entries()) {
    store.setServerInvites(serverId, rows)
  }

  // Ensure deletions and filters are reflected for servers that now have zero invites.
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

function syncDmServerInvites(conn: DbConnection): void {
  const rows: DmServerInvite[] = Array.from(conn.db.dm_server_invite.iter()).map(mapDmServerInvite)
  useDmServerInvitesStore.getState().setInvites(rows)
}

function syncServerScopedState(conn: DbConnection, users: User[] = syncUsers(conn)): void {
  syncServers(conn)
  syncMembers(conn, users)
  syncChannels(conn)
  syncInvites(conn)
}

function syncAll(conn: DbConnection): void {
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

function resetClientState(): void {
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

function watchLiveTables(conn: DbConnection): void {
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
    if (!liveEventsEnabled) return
    const me = useConnectionStore.getState().identity
    if (!me) return

    const mapped = mapFriend(row)
    if (mapped.status === 'Pending' && mapped.requestedBy !== me) {
      handleIncomingFriendRequest(findDisplayNameByIdentity(mapped.requestedBy))
    }
  })
  conn.db.my_friends.onUpdate((_ctx, _oldRow, row) => {
    syncFriends(conn)
    if (!liveEventsEnabled) return
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
    if (!liveEventsEnabled) return
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

  // Invite table live sync
  conn.db.invite.onInsert(() => syncInvites(conn))
  conn.db.invite.onUpdate(() => syncInvites(conn))
  conn.db.invite.onDelete(() => syncInvites(conn))

  // DmServerInvite table live sync
  conn.db.dm_server_invite.onInsert((_ctx, row) => {
    syncDmServerInvites(conn)
    if (!liveEventsEnabled) return
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
    if (!liveEventsEnabled) return

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

function reducerEnum(tag: string): { tag: string } {
  return { tag }
}

type U64Input = number | bigint | string

function toU64(value: U64Input, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${fieldName} must be a non-negative integer`)
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`${fieldName} must be a non-negative integer`)
    }
    return BigInt(value)
  }

  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${fieldName} must be a non-negative integer`)
  }
  return BigInt(normalized)
}

function toOptionalU64(value: U64Input | null | undefined, fieldName: string): bigint | null {
  if (value === null || value === undefined) return null
  return toU64(value, fieldName)
}

function toReducerIdentity(value: Identity | SpacetimeIdentity): SpacetimeIdentityClass {
  if (value && typeof value === 'object' && 'toHexString' in value) {
    return value as SpacetimeIdentityClass
  }
  return new SpacetimeIdentityClass(String(value))
}

function getStoredToken(): string | undefined {
  const token = localStorage.getItem(SPACETIMEDB_TOKEN_KEY)
  return token ?? undefined
}

function setStoredToken(token: string): void {
  localStorage.setItem(SPACETIMEDB_TOKEN_KEY, token)
}

function clearStoredToken(): void {
  localStorage.removeItem(SPACETIMEDB_TOKEN_KEY)
}

async function connect(): Promise<void> {
  if (connection?.isActive) return
  if (connectPromise) return connectPromise

  if (isPlaceholderEndpoint(SPACETIMEDB_URI)) {
    throw new Error(
      `SpacetimeDB URI is still a placeholder (${SPACETIMEDB_URI}). Rebuild with a real VITE_SPACETIMEDB_URI.`,
    )
  }

  connectPromise = (async () => {
    useConnectionStore.getState().setStatus('connecting')

    let appliedOnce = false
    let resolveApplied: (() => void) | null = null
    let rejectApplied: ((error: unknown) => void) | null = null
    const firstSyncApplied = new Promise<void>((resolve, reject) => {
      resolveApplied = resolve
      rejectApplied = reject
    })
    const rejectIfPending = (error: unknown): void => {
      if (appliedOnce) return
      appliedOnce = true
      rejectApplied?.(error)
    }
    const connectTimeoutMs = 15000
    const connectTimeout = setTimeout(() => {
      rejectIfPending(
        new Error(
          `Timed out connecting to SpacetimeDB at ${SPACETIMEDB_URI}. Ensure \`spacetime start\` is running and the module is published.`,
        ),
      )
    }, connectTimeoutMs)

    const builder = DbConnection.builder()
      .withUri(SPACETIMEDB_URI)
      .withDatabaseName(SPACETIMEDB_DATABASE)
      .withLightMode(false)
      .withToken(getStoredToken())
      .onConnect((conn, identity, token) => {
        connection = conn
        const identityString = toIdentityString(identity)
        useConnectionStore.getState().setStatus('connected')
        useConnectionStore.getState().setIdentity(identityString)
        setStoredToken(token)
      })
      .onDisconnect(() => {
        useConnectionStore.getState().setStatus('disconnected')
        rejectIfPending(new Error('Disconnected before initial data sync completed.'))
      })
      .onConnectError((_ctx, error) => {
        void _ctx
        const details = getConnectionErrorDetails(error)
        const wrapped = new Error(`SpacetimeDB connection failed at ${SPACETIMEDB_URI} (${details}).`)
        rejectIfPending(wrapped)
        void onError(wrapped)
      })

    connection = builder.build()
    watchLiveTables(connection)

    subscriptionHandle = connection
      .subscriptionBuilder()
      .onApplied(() => {
        syncAll(connection as DbConnection)
        liveEventsEnabled = true
        if (appliedOnce) return
        appliedOnce = true
        clearTimeout(connectTimeout)
        resolveApplied?.()
      })
      .onError((_ctx) => {
        void _ctx
        void onError(new Error('Subscription failed'))
        clearTimeout(connectTimeout)
        rejectIfPending(new Error('Subscription failed'))
      })
      .subscribe([
        tables.user,
        tables.server,
        tables.server_member,
        tables.channel,
        tables.message,
        tables.voice_participant,
        tables.my_friends,
        tables.my_blocks,
        tables.direct_message,
        tables.my_dm_voice_participants,
        tables.my_presence_states,
        tables.my_typing_states,
        tables.my_read_states,
        tables.invite,
        tables.dm_server_invite,
      ])

    try {
      await firstSyncApplied
    } finally {
      clearTimeout(connectTimeout)
    }
  })()

  try {
    await connectPromise
  } finally {
    connectPromise = null
  }
}

function disconnect(): void {
  if (connection) {
    const offlineReducer = connection.reducers?.setPresenceOffline
    if (typeof offlineReducer === 'function') {
      void offlineReducer({})
    }
  }
  subscriptionHandle?.unsubscribe()
  subscriptionHandle = null
  liveEventsEnabled = false
  connection?.disconnect()
  connection = null
  connectPromise = null
  useConnectionStore.getState().setStatus('disconnected')
  resetClientState()
}

async function call<TArgs extends Record<string, unknown>>(reducer: string, args?: TArgs): Promise<void> {
  if (!connection) {
    await connect()
  }

  const currentConnection = connection
  if (!currentConnection) {
    throw new Error('SpacetimeDB connection is not available')
  }

  const reducersByName = currentConnection.reducers as unknown as
    Record<string, ((args?: Record<string, unknown>) => Promise<void>) | undefined>
  const reducerFn = reducersByName?.[reducer]
  if (typeof reducerFn !== 'function') {
    throw new Error(`Reducer not found: ${reducer}`)
  }

  await reducerFn(args ?? {})
}

export const spacetimedbClient: SpacetimeDBClient = {
  get connection() {
    return connection
  },
  connect,
  disconnect,
  call,
}

export const reducers = {
  registerUser: (username: string, displayName: string) =>
    spacetimedbClient.call('registerUser', { username, displayName }),
  updateProfile: (displayName?: string, avatarUrl?: string) =>
    spacetimedbClient.call('updateProfile', { displayName: displayName ?? null, avatarUrl: avatarUrl ?? null }),
  createServer: (name: string) => spacetimedbClient.call('createServer', { name }),
  renameServer: (serverId: number, newName: string) =>
    spacetimedbClient.call('renameServer', { serverId: toU64(serverId, 'serverId'), newName }),
  setServerInvitePolicy: (serverId: number, invitePolicy: ServerInvitePolicy) =>
    spacetimedbClient.call('setServerInvitePolicy', {
      serverId: toU64(serverId, 'serverId'),
      invitePolicy: reducerEnum(invitePolicy),
    }),
  deleteServer: (serverId: number) => spacetimedbClient.call('deleteServer', { serverId: toU64(serverId, 'serverId') }),
  leaveServer: (serverId: number) => spacetimedbClient.call('leaveServer', { serverId: toU64(serverId, 'serverId') }),
  createInvite: (serverId: number, expiresInSeconds?: number, maxUses?: number, allowedUsernames?: string[]) =>
    spacetimedbClient.call('createInvite', {
      serverId: toU64(serverId, 'serverId'),
      expiresInSeconds: toOptionalU64(expiresInSeconds, 'expiresInSeconds'),
      maxUses: maxUses ?? null,
      allowedUsernames: allowedUsernames ?? [],
    }),
  deleteInvite: (token: string) => spacetimedbClient.call('deleteInvite', { token }),
  useInvite: (token: string) => spacetimedbClient.call('useInvite', { token }),
  cleanupExpiredInvites: () => spacetimedbClient.call('cleanupExpiredInvites'),
  sendDmServerInvite: (recipientIdentity: Identity, serverId: number) =>
    spacetimedbClient.call('sendDmServerInvite', {
      recipientIdentity: toReducerIdentity(recipientIdentity),
      serverId: toU64(serverId, 'serverId'),
    }),
  respondDmServerInvite: (inviteId: number, accept: boolean) =>
    spacetimedbClient.call('respondDmServerInvite', {
      inviteId: toU64(inviteId, 'inviteId'),
      accept,
    }),
  timeoutMember: (serverId: number, targetIdentity: Identity, durationSeconds: number) =>
    spacetimedbClient.call('timeoutMember', {
      serverId: toU64(serverId, 'serverId'),
      targetIdentity: toReducerIdentity(targetIdentity),
      durationSeconds: toU64(durationSeconds, 'durationSeconds'),
    }),
  removeTimeout: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('removeTimeout', {
      serverId: toU64(serverId, 'serverId'),
      targetIdentity: toReducerIdentity(targetIdentity),
    }),
  kickMember: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('kickMember', {
      serverId: toU64(serverId, 'serverId'),
      targetIdentity: toReducerIdentity(targetIdentity),
    }),
  banMember: (serverId: number, targetIdentity: Identity, reason?: string) =>
    spacetimedbClient.call('banMember', {
      serverId: toU64(serverId, 'serverId'),
      targetIdentity: toReducerIdentity(targetIdentity),
      reason: reason ?? null,
    }),
  unbanMember: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('unbanMember', {
      serverId: toU64(serverId, 'serverId'),
      targetIdentity: toReducerIdentity(targetIdentity),
    }),
  setMemberRole: (serverId: number, targetIdentity: Identity, newRole: 'Member' | 'Moderator') =>
    spacetimedbClient.call('setMemberRole', {
      serverId: toU64(serverId, 'serverId'),
      targetIdentity: toReducerIdentity(targetIdentity),
      newRole: reducerEnum(newRole),
    }),
  transferOwnership: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('transferOwnership', {
      serverId: toU64(serverId, 'serverId'),
      targetIdentity: toReducerIdentity(targetIdentity),
    }),
  createChannel: (serverId: number, name: string, kind: 'Text' | 'Voice', moderatorOnly: boolean) =>
    spacetimedbClient.call('createChannel', {
      serverId: toU64(serverId, 'serverId'),
      name,
      kind: reducerEnum(kind),
      moderatorOnly,
    }),
  updateChannel: (channelId: number, payload: { name?: string; moderatorOnly?: boolean; position?: number }) =>
    spacetimedbClient.call('updateChannel', {
      channelId: toU64(channelId, 'channelId'),
      name: payload.name ?? null,
      moderatorOnly: payload.moderatorOnly ?? null,
      position: payload.position ?? null,
    }),
  deleteChannel: (channelId: number) =>
    spacetimedbClient.call('deleteChannel', { channelId: toU64(channelId, 'channelId') }),
  sendMessage: (channelId: number, content: string) =>
    spacetimedbClient.call('sendMessage', { channelId: toU64(channelId, 'channelId'), content }),
  editMessage: (messageId: number, newContent: string) =>
    spacetimedbClient.call('editMessage', { messageId: toU64(messageId, 'messageId'), newContent }),
  deleteMessage: (messageId: number) =>
    spacetimedbClient.call('deleteMessage', { messageId: toU64(messageId, 'messageId') }),
  touchPresence: () => spacetimedbClient.call('touchPresence'),
  setPresenceOffline: () => spacetimedbClient.call('setPresenceOffline'),
  setTypingState: (scopeKey: string, isTyping: boolean) =>
    spacetimedbClient.call('setTypingState', { scopeKey, isTyping }),
  markChannelRead: (channelId: number) =>
    spacetimedbClient.call('markChannelRead', { channelId: toU64(channelId, 'channelId') }),
  markDmRead: (otherIdentity: Identity) =>
    spacetimedbClient.call('markDmRead', { otherIdentity: toReducerIdentity(otherIdentity) }),
  joinVoiceChannel: (channelId: number) =>
    spacetimedbClient.call('joinVoiceChannel', { channelId: toU64(channelId, 'channelId') }),
  leaveVoiceChannel: (channelId: number) =>
    spacetimedbClient.call('leaveVoiceChannel', { channelId: toU64(channelId, 'channelId') }),
  updateVoiceState: (
    channelId: number,
    muted: boolean,
    deafened: boolean,
    sharingScreen: boolean,
    sharingCamera: boolean,
  ) =>
    spacetimedbClient.call('updateVoiceState', {
      channelId: toU64(channelId, 'channelId'),
      muted,
      deafened,
      sharingScreen,
      sharingCamera,
    }),
  joinDmVoice: (otherIdentity: Identity) =>
    spacetimedbClient.call('joinDmVoice', { otherIdentity: toReducerIdentity(otherIdentity) }),
  leaveDmVoice: (otherIdentity: Identity) =>
    spacetimedbClient.call('leaveDmVoice', { otherIdentity: toReducerIdentity(otherIdentity) }),
  updateDmVoiceState: (
    otherIdentity: Identity,
    muted: boolean,
    deafened: boolean,
    sharingScreen: boolean,
    sharingCamera: boolean,
  ) =>
    spacetimedbClient.call('updateDmVoiceState', {
      otherIdentity: toReducerIdentity(otherIdentity),
      muted,
      deafened,
      sharingScreen,
      sharingCamera,
    }),
  sendFriendRequest: (targetIdentity: Identity) =>
    spacetimedbClient.call('sendFriendRequest', { targetIdentity: toReducerIdentity(targetIdentity) }),
  acceptFriendRequest: (requesterIdentity: Identity) =>
    spacetimedbClient.call('acceptFriendRequest', { requesterIdentity: toReducerIdentity(requesterIdentity) }),
  declineFriendRequest: (requesterIdentity: Identity) =>
    spacetimedbClient.call('declineFriendRequest', { requesterIdentity: toReducerIdentity(requesterIdentity) }),
  removeFriend: (otherIdentity: Identity) =>
    spacetimedbClient.call('removeFriend', { otherIdentity: toReducerIdentity(otherIdentity) }),
  blockUser: (targetIdentity: Identity) =>
    spacetimedbClient.call('blockUser', { targetIdentity: toReducerIdentity(targetIdentity) }),
  unblockUser: (targetIdentity: Identity) =>
    spacetimedbClient.call('unblockUser', { targetIdentity: toReducerIdentity(targetIdentity) }),
  sendDirectMessage: (recipientIdentity: Identity, content: string) =>
    spacetimedbClient.call('sendDirectMessage', {
      recipientIdentity: toReducerIdentity(recipientIdentity),
      content,
    }),
  deleteDirectMessage: (messageId: number) =>
    spacetimedbClient.call('deleteDirectMessage', { messageId: toU64(messageId, 'messageId') }),
}

export const onConnect = async (): Promise<void> => {
  useConnectionStore.getState().setStatus('connected')
}

export const onDisconnect = async (): Promise<void> => {
  useConnectionStore.getState().setStatus('disconnected')
}

export const onError = async (error: unknown): Promise<void> => {
  useConnectionStore.getState().setStatus('disconnected')
  const body = error instanceof Error ? error.message : 'Unknown connection error'
  await notify('system', {
    title: 'Connection Error',
    body,
    dedupeKey: `connection_error:${body}`,
  })
}

export async function initializeSpacetime(): Promise<void> {
  await connect()
}

export function getCurrentSessionToken(): string | null {
  return getStoredToken() ?? null
}

export async function signOut(): Promise<void> {
  if (connection) {
    const offlineReducer = connection.reducers?.setPresenceOffline
    if (typeof offlineReducer === 'function') {
      try {
        await offlineReducer({})
      } catch {
        // best-effort: keep sign-out flow resilient even if reducer call fails.
      }
    }
  }
  disconnect()
  clearStoredToken()
  clearStoredAuthSessionToken()
  await clearBadgeCount()
}

export async function rotateIdentityForRegistration(): Promise<void> {
  // Registration always creates a user for the current anonymous identity.
  // To avoid sticky stale identities, force a fresh tokenless reconnect.
  disconnect()
  clearStoredToken()
  await connect()
}

async function ensureAuthenticatedUserRow(normalizedUsername: string, displayName: string): Promise<void> {
  if (!connection) {
    await connect()
  }
  const conn = connection as DbConnection
  syncUsers(conn)
  if (useSelfStore.getState().user) return

  const currentIdentity = useConnectionStore.getState().identity
  if (!currentIdentity) {
    throw new Error('Login succeeded but no Spacetime identity is active.')
  }

  const existingUsernameOwner = Array.from(conn.db.user.iter()).find(
    (row) => row.username.toLowerCase() === normalizedUsername,
  )
  if (existingUsernameOwner) {
    const ownerIdentity = toIdentityString(existingUsernameOwner.identity)
    if (!sameIdentity(ownerIdentity, currentIdentity)) {
      throw new Error(
        'This username is linked to a different Spacetime identity. Re-link from a currently signed-in session.',
      )
    }
  }

  try {
    await reducers.registerUser(normalizedUsername, displayName)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('user already registered for this identity')) {
      throw error
    }
  }

  syncUsers(conn)
  if (!useSelfStore.getState().user) {
    throw new Error('Login succeeded but user profile is not available for this identity.')
  }
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
  const normalized = normalizeUsername(username)
  if (!normalized) throw new Error('Username is required.')
  if (password.length < 8) throw new Error('Password must be at least 8 characters.')

  const auth = await authServiceLogin({
    username: normalized,
    password,
  })

  disconnect()
  setStoredToken(auth.spacetimeToken)
  try {
    await connect()
  } catch (error) {
    clearStoredToken()
    throw error
  }

  const connectedIdentity = useConnectionStore.getState().identity
  if (!connectedIdentity) {
    disconnect()
    clearStoredToken()
    throw new Error('Login failed: authenticated session has no active identity.')
  }

  if (!sameIdentity(connectedIdentity, auth.spacetimeIdentity)) {
    disconnect()
    clearStoredToken()
    throw new Error(
      'Login token is stale for this account. Sign in from a linked session and relink this device in Settings.',
    )
  }

  // Update the auth service with the fresh token SpacetimeDB issued during this connection,
  // so the next login won't hit a stale token.
  const freshToken = getCurrentSessionToken()
  if (freshToken) {
    authServiceRefreshSpacetimeToken({ sessionToken: auth.sessionToken, spacetimeToken: freshToken })
      .catch(() => undefined) // best-effort, never fail login over this
  }

  await ensureAuthenticatedUserRow(normalized, auth.displayName)
}

export async function resolveIdentityFromUsername(username: string): Promise<Identity | null> {
  if (!connection) {
    await connect()
  }

  const normalized = username.trim().toLowerCase()
  const user = Array.from((connection as DbConnection).db.user.iter()).find((row) => row.username.toLowerCase() === normalized)
  return user ? toIdentityString(user.identity) : null
}

function updateUnreadBadgeCount(): void {
  void syncUnreadBadgeCount()
}

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

function formatDurationLabel(durationSeconds: number): string {
  const total = Math.max(0, Math.round(durationSeconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function parseDmCallSystemMessage(content: string): { kind: 'call_started' | 'call_ended'; missed: boolean; durationLabel?: string } | null {
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
  const mentionNeedles = [
    `@${self.username.toLowerCase()}`,
    `@${self.displayName.toLowerCase()}`,
  ]
  return mentionNeedles.some((needle) => normalizedContent.includes(needle))
}

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
  const isActiveView =
    ui.activeDmPartner !== null && sameIdentity(ui.activeDmPartner, partnerIdentity)
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

export { tables }
