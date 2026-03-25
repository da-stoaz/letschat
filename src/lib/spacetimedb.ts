import type { DbConnectionImpl, Identity as SpacetimeIdentity, Timestamp as SpacetimeTimestamp } from 'spacetimedb'
import { DbConnection, tables } from '../generated'
import { useChannelsStore } from '../stores/channelsStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useDmStore } from '../stores/dmStore'
import { useFriendsStore } from '../stores/friendsStore'
import { useMembersStore } from '../stores/membersStore'
import { useMessagesStore } from '../stores/messagesStore'
import { useSelfStore } from '../stores/selfStore'
import { useServersStore } from '../stores/serversStore'
import { useUiStore } from '../stores/uiStore'
import { useVoiceStore } from '../stores/voiceStore'
import { tauriCommands } from './tauri'
import type { ServerMemberWithUser } from '../stores/membersStore'
import type {
  Block,
  Channel,
  ChannelKind,
  DirectMessage,
  Friend,
  FriendStatus,
  Identity,
  Message,
  Role,
  Server,
  ServerMember,
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

function mapUser(row: any): User {
  return {
    identity: toIdentityString(row.identity),
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    createdAt: toIsoString(row.createdAt),
  }
}

function mapServer(row: any): Server {
  return {
    id: toU64Number(row.id),
    name: row.name,
    ownerIdentity: toIdentityString(row.ownerIdentity),
    iconUrl: row.iconUrl ?? null,
    createdAt: toIsoString(row.createdAt),
  }
}

function mapServerMember(row: any): ServerMember {
  return {
    serverId: toU64Number(row.serverId),
    userIdentity: toIdentityString(row.userIdentity),
    role: enumTag(row.role) as Role,
    joinedAt: toIsoString(row.joinedAt),
  }
}

function mapChannel(row: any): Channel {
  return {
    id: toU64Number(row.id),
    serverId: toU64Number(row.serverId),
    name: row.name,
    kind: enumTag(row.kind) as ChannelKind,
    position: Number(row.position),
    moderatorOnly: Boolean(row.moderatorOnly),
  }
}

function mapMessage(row: any): Message {
  return {
    id: toU64Number(row.id),
    channelId: toU64Number(row.channelId),
    senderIdentity: toIdentityString(row.senderIdentity),
    content: row.content,
    sentAt: toIsoString(row.sentAt),
    editedAt: row.editedAt ? toIsoString(row.editedAt) : null,
    deleted: Boolean(row.deleted),
  }
}

function mapVoiceParticipant(row: any): VoiceParticipant {
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

function mapFriend(row: any): Friend {
  return {
    userA: toIdentityString(row.userA),
    userB: toIdentityString(row.userB),
    status: enumTag(row.status) as FriendStatus,
    requestedBy: toIdentityString(row.requestedBy),
    updatedAt: toIsoString(row.updatedAt),
  }
}

function mapBlock(row: any): Block {
  return {
    blocker: toIdentityString(row.blocker),
    blocked: toIdentityString(row.blocked),
    createdAt: toIsoString(row.createdAt),
  }
}

function mapDirectMessage(row: any): DirectMessage {
  return {
    id: toU64Number(row.id),
    senderIdentity: toIdentityString(row.senderIdentity),
    recipientIdentity: toIdentityString(row.recipientIdentity),
    content: row.content,
    sentAt: toIsoString(row.sentAt),
    deletedBySender: Boolean(row.deletedBySender),
    deletedByRecipient: Boolean(row.deletedByRecipient),
  }
}

function syncUsers(conn: DbConnection): User[] {
  const users = Array.from(conn.db.user.iter()).map(mapUser)
  const selfIdentity = useConnectionStore.getState().identity

  if (selfIdentity) {
    useSelfStore.getState().setUser(users.find((user) => user.identity === selfIdentity) ?? null)
  }

  return users
}

function syncServers(conn: DbConnection): void {
  const servers = Array.from(conn.db.server.iter()).map(mapServer)
  useServersStore.getState().setServers(servers)
}

function syncMembers(conn: DbConnection): void {
  const users = syncUsers(conn)
  const usersByIdentity = new Map(users.map((user) => [user.identity, user]))
  const members = Array.from(conn.db.server_member.iter()).map(mapServerMember)
  const grouped = new Map<number, ServerMemberWithUser[]>()

  for (const member of members) {
    const byServer = grouped.get(member.serverId) ?? []
    byServer.push({ ...member, user: usersByIdentity.get(member.userIdentity) ?? null })
    grouped.set(member.serverId, byServer)
  }

  const store = useMembersStore.getState()
  for (const [serverId, rows] of grouped.entries()) {
    store.setServerMembers(serverId, rows)
  }
}

function syncChannels(conn: DbConnection): void {
  const channels = Array.from(conn.db.channel.iter()).map(mapChannel)
  const grouped = new Map<number, Channel[]>()
  for (const channel of channels) {
    const byServer = grouped.get(channel.serverId) ?? []
    byServer.push(channel)
    grouped.set(channel.serverId, byServer)
  }

  const store = useChannelsStore.getState()
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
  for (const [channelId, rows] of grouped.entries()) {
    store.setParticipants(channelId, rows)
  }
}

function syncFriends(conn: DbConnection): void {
  useFriendsStore.getState().setFriends(Array.from(conn.db.friend.iter()).map(mapFriend))
  useFriendsStore.getState().setBlocked(Array.from(conn.db.block.iter()).map(mapBlock))
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

function syncAll(conn: DbConnection): void {
  syncUsers(conn)
  syncServers(conn)
  syncChannels(conn)
  syncMembers(conn)
  syncMessages(conn)
  syncVoiceParticipants(conn)
  syncFriends(conn)
  syncDirectMessages(conn)
}

function watchLiveTables(conn: DbConnection): void {
  conn.db.user.onInsert(() => syncUsers(conn))
  conn.db.user.onUpdate(() => syncUsers(conn))
  conn.db.server.onInsert(() => syncServers(conn))
  conn.db.server.onUpdate(() => syncServers(conn))
  conn.db.server.onDelete(() => syncServers(conn))
  conn.db.server_member.onInsert(() => syncMembers(conn))
  conn.db.server_member.onUpdate(() => syncMembers(conn))
  conn.db.server_member.onDelete(() => syncMembers(conn))
  conn.db.channel.onInsert(() => syncChannels(conn))
  conn.db.channel.onUpdate(() => syncChannels(conn))
  conn.db.channel.onDelete(() => syncChannels(conn))
  conn.db.voice_participant.onInsert(() => syncVoiceParticipants(conn))
  conn.db.voice_participant.onUpdate(() => syncVoiceParticipants(conn))
  conn.db.voice_participant.onDelete(() => syncVoiceParticipants(conn))
  conn.db.friend.onInsert((_ctx, row) => {
    syncFriends(conn)
    if (!liveEventsEnabled) return
    const me = useConnectionStore.getState().identity
    if (!me) return

    const mapped = mapFriend(row)
    if (mapped.status === 'Pending' && mapped.requestedBy !== me) {
      handleIncomingFriendRequest(mapped.requestedBy)
    }
  })
  conn.db.friend.onUpdate((_ctx, _oldRow, row) => {
    syncFriends(conn)
    if (!liveEventsEnabled) return
    const me = useConnectionStore.getState().identity
    if (!me) return

    const mapped = mapFriend(row)
    if (mapped.status === 'Accepted' && mapped.requestedBy === me) {
      handleFriendAccepted(mapped.userA === me ? mapped.userB : mapped.userA)
    }
  })
  conn.db.friend.onDelete(() => syncFriends(conn))
  conn.db.block.onInsert(() => syncFriends(conn))
  conn.db.block.onDelete(() => syncFriends(conn))
  conn.db.direct_message.onInsert(() => syncDirectMessages(conn))
  conn.db.direct_message.onUpdate(() => syncDirectMessages(conn))
  conn.db.direct_message.onDelete(() => syncDirectMessages(conn))
  conn.db.message.onInsert((_ctx, row) => {
    syncMessages(conn)
    if (!liveEventsEnabled) return

    const message = mapMessage(row)
    const senderIsSelf = useConnectionStore.getState().identity === message.senderIdentity
    handleIncomingMessage(message.channelId, senderIsSelf)
  })
  conn.db.message.onUpdate(() => syncMessages(conn))
  conn.db.message.onDelete(() => syncMessages(conn))
}

function reducerEnum(tag: string): { tag: string } {
  return { tag }
}

function getStoredToken(): string | undefined {
  const token = localStorage.getItem(SPACETIMEDB_TOKEN_KEY)
  return token ?? undefined
}

function setStoredToken(token: string): void {
  localStorage.setItem(SPACETIMEDB_TOKEN_KEY, token)
}

async function connect(): Promise<void> {
  if (connection?.isActive) return
  if (connectPromise) return connectPromise

  connectPromise = (async () => {
    useConnectionStore.getState().setStatus('connecting')

    const builder = DbConnection.builder()
      .withUri(SPACETIMEDB_URI)
      .withDatabaseName(SPACETIMEDB_DATABASE)
      .withLightMode(false)
      .withToken(getStoredToken())
      .onConnect((conn, identity, token) => {
        connection = conn
        useConnectionStore.getState().setStatus('connected')
        useConnectionStore.getState().setIdentity(toIdentityString(identity))
        setStoredToken(token)
      })
      .onDisconnect(() => {
        useConnectionStore.getState().setStatus('disconnected')
      })
      .onConnectError((_ctx, error) => {
        void onError(error)
      })

    connection = builder.build()
    watchLiveTables(connection)

    subscriptionHandle = connection
      .subscriptionBuilder()
      .onApplied(() => {
        syncAll(connection as DbConnection)
        liveEventsEnabled = true
      })
      .onError((_ctx) => {
        void onError(new Error('Subscription failed'))
      })
      .subscribe([
        tables.user,
        tables.server,
        tables.server_member,
        tables.channel,
        tables.message,
        tables.voice_participant,
        tables.friend,
        tables.block,
        tables.direct_message,
      ])

    await Promise.resolve()
  })()

  try {
    await connectPromise
  } finally {
    connectPromise = null
  }
}

function disconnect(): void {
  subscriptionHandle?.unsubscribe()
  subscriptionHandle = null
  liveEventsEnabled = false
  connection?.disconnect()
  connection = null
  useConnectionStore.getState().setStatus('disconnected')
}

async function call<TArgs extends Record<string, unknown>>(reducer: string, args?: TArgs): Promise<void> {
  if (!connection) {
    await connect()
  }

  const reducerFn = (connection as DbConnectionImpl<any>).reducers?.[reducer]
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
  renameServer: (serverId: number, newName: string) => spacetimedbClient.call('renameServer', { serverId, newName }),
  deleteServer: (serverId: number) => spacetimedbClient.call('deleteServer', { serverId }),
  createInvite: (serverId: number, expiresInSeconds?: number, maxUses?: number) =>
    spacetimedbClient.call('createInvite', {
      serverId,
      expiresInSeconds: expiresInSeconds ?? null,
      maxUses: maxUses ?? null,
    }),
  useInvite: (token: string) => spacetimedbClient.call('useInvite', { token }),
  kickMember: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('kickMember', { serverId, targetIdentity }),
  banMember: (serverId: number, targetIdentity: Identity, reason?: string) =>
    spacetimedbClient.call('banMember', { serverId, targetIdentity, reason: reason ?? null }),
  unbanMember: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('unbanMember', { serverId, targetIdentity }),
  setMemberRole: (serverId: number, targetIdentity: Identity, newRole: 'Member' | 'Moderator') =>
    spacetimedbClient.call('setMemberRole', {
      serverId,
      targetIdentity,
      newRole: reducerEnum(newRole),
    }),
  transferOwnership: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('transferOwnership', { serverId, targetIdentity }),
  createChannel: (serverId: number, name: string, kind: 'Text' | 'Voice', moderatorOnly: boolean) =>
    spacetimedbClient.call('createChannel', {
      serverId,
      name,
      kind: reducerEnum(kind),
      moderatorOnly,
    }),
  updateChannel: (channelId: number, payload: { name?: string; moderatorOnly?: boolean; position?: number }) =>
    spacetimedbClient.call('updateChannel', {
      channelId,
      name: payload.name ?? null,
      moderatorOnly: payload.moderatorOnly ?? null,
      position: payload.position ?? null,
    }),
  deleteChannel: (channelId: number) => spacetimedbClient.call('deleteChannel', { channelId }),
  sendMessage: (channelId: number, content: string) => spacetimedbClient.call('sendMessage', { channelId, content }),
  editMessage: (messageId: number, newContent: string) =>
    spacetimedbClient.call('editMessage', { messageId, newContent }),
  deleteMessage: (messageId: number) => spacetimedbClient.call('deleteMessage', { messageId }),
  joinVoiceChannel: (channelId: number) => spacetimedbClient.call('joinVoiceChannel', { channelId }),
  leaveVoiceChannel: (channelId: number) => spacetimedbClient.call('leaveVoiceChannel', { channelId }),
  updateVoiceState: (
    channelId: number,
    muted: boolean,
    deafened: boolean,
    sharingScreen: boolean,
    sharingCamera: boolean,
  ) => spacetimedbClient.call('updateVoiceState', { channelId, muted, deafened, sharingScreen, sharingCamera }),
  sendFriendRequest: (targetIdentity: Identity) => spacetimedbClient.call('sendFriendRequest', { targetIdentity }),
  acceptFriendRequest: (requesterIdentity: Identity) =>
    spacetimedbClient.call('acceptFriendRequest', { requesterIdentity }),
  declineFriendRequest: (requesterIdentity: Identity) =>
    spacetimedbClient.call('declineFriendRequest', { requesterIdentity }),
  removeFriend: (otherIdentity: Identity) => spacetimedbClient.call('removeFriend', { otherIdentity }),
  blockUser: (targetIdentity: Identity) => spacetimedbClient.call('blockUser', { targetIdentity }),
  unblockUser: (targetIdentity: Identity) => spacetimedbClient.call('unblockUser', { targetIdentity }),
  sendDirectMessage: (recipientIdentity: Identity, content: string) =>
    spacetimedbClient.call('sendDirectMessage', { recipientIdentity, content }),
  deleteDirectMessage: (messageId: number) => spacetimedbClient.call('deleteDirectMessage', { messageId }),
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
  await tauriCommands.showNotification('Connection Error', body).catch(() => undefined)
}

export async function initializeSpacetime(): Promise<void> {
  await connect()
}

export async function resolveIdentityFromUsername(username: string): Promise<Identity | null> {
  if (!connection) {
    await connect()
  }

  const normalized = username.trim().toLowerCase()
  const user = Array.from((connection as DbConnection).db.user.iter()).find((row) => row.username.toLowerCase() === normalized)
  return user ? toIdentityString(user.identity) : null
}

export function handleIncomingMessage(channelId: number, senderIsSelf: boolean): void {
  const ui = useUiStore.getState()
  if (senderIsSelf) return
  if (ui.activeChannelId !== channelId) {
    ui.incrementUnread(channelId)
    const totalUnread = Object.values(useUiStore.getState().unreadByChannel).reduce((sum, value) => sum + value, 0)
    void tauriCommands.setBadgeCount(totalUnread).catch(() => undefined)
    void tauriCommands.showNotification('New Message', `Unread message in channel ${channelId}`).catch(() => undefined)
  }
}

export function handleIncomingFriendRequest(username: string): void {
  void tauriCommands.showNotification('Friend Request', `New friend request from ${username}`).catch(() => undefined)
}

export function handleFriendAccepted(username: string): void {
  void tauriCommands
    .showNotification('Friend Request Accepted', `${username} accepted your friend request`)
    .catch(() => undefined)
}

export { tables }
