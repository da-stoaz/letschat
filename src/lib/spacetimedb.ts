import type { DbConnectionImpl } from 'spacetimedb'
import { useConnectionStore } from '../stores/connectionStore'
import { useSelfStore } from '../stores/selfStore'
import { useUiStore } from '../stores/uiStore'
import { tauriCommands } from './tauri'
import type { Identity } from '../types/domain'

export type SpacetimeDBClient = {
  connection: DbConnectionImpl<any> | null
  connect: () => Promise<void>
  disconnect: () => void
  call: <TArgs extends Record<string, unknown>>(reducer: string, args?: TArgs) => Promise<void>
}

const SPACETIMEDB_URI = (import.meta.env.VITE_SPACETIMEDB_URI as string | undefined) ?? 'ws://localhost:3000'
const SPACETIMEDB_DATABASE = (import.meta.env.VITE_SPACETIMEDB_DATABASE as string | undefined) ?? 'letschat'

let connection: DbConnectionImpl<any> | null = null

async function connect(): Promise<void> {
  const connectionStore = useConnectionStore.getState()
  connectionStore.setStatus('connecting')

  // Placeholder while server bindings are not generated.
  // We still keep app-level connection state wiring for UI and routing.
  await new Promise((resolve) => setTimeout(resolve, 150))

  connectionStore.setStatus('connected')
  connectionStore.setIdentity(`guest:${Date.now()}` as Identity)

  // Fallback bootstrap self object for dev loop.
  if (!useSelfStore.getState().user) {
    useSelfStore.getState().setUser({
      identity: useConnectionStore.getState().identity ?? 'guest',
      username: 'new_user',
      displayName: 'New User',
      avatarUrl: null,
      createdAt: new Date().toISOString(),
    })
  }

  console.debug('SpacetimeDB placeholder connected', { SPACETIMEDB_URI, SPACETIMEDB_DATABASE })
}

function disconnect(): void {
  connection?.disconnect()
  connection = null
  useConnectionStore.getState().setStatus('disconnected')
}

async function call<TArgs extends Record<string, unknown>>(_reducer: string, _args?: TArgs): Promise<void> {
  // Placeholder until generated module bindings are integrated.
  // Keep this as a successful no-op for UI progression.
  await Promise.resolve()
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
    spacetimedbClient.call('register_user', { username, display_name: displayName }),
  updateProfile: (displayName?: string, avatarUrl?: string) =>
    spacetimedbClient.call('update_profile', { display_name: displayName, avatar_url: avatarUrl }),
  createServer: (name: string) => spacetimedbClient.call('create_server', { name }),
  renameServer: (serverId: number, newName: string) =>
    spacetimedbClient.call('rename_server', { server_id: serverId, new_name: newName }),
  deleteServer: (serverId: number) => spacetimedbClient.call('delete_server', { server_id: serverId }),
  createInvite: (serverId: number, expiresInSeconds?: number, maxUses?: number) =>
    spacetimedbClient.call('create_invite', {
      server_id: serverId,
      expires_in_seconds: expiresInSeconds,
      max_uses: maxUses,
    }),
  useInvite: (token: string) => spacetimedbClient.call('use_invite', { token }),
  kickMember: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('kick_member', { server_id: serverId, target_identity: targetIdentity }),
  banMember: (serverId: number, targetIdentity: Identity, reason?: string) =>
    spacetimedbClient.call('ban_member', { server_id: serverId, target_identity: targetIdentity, reason }),
  unbanMember: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('unban_member', { server_id: serverId, target_identity: targetIdentity }),
  setMemberRole: (serverId: number, targetIdentity: Identity, newRole: 'Member' | 'Moderator') =>
    spacetimedbClient.call('set_member_role', {
      server_id: serverId,
      target_identity: targetIdentity,
      new_role: newRole,
    }),
  transferOwnership: (serverId: number, targetIdentity: Identity) =>
    spacetimedbClient.call('transfer_ownership', { server_id: serverId, target_identity: targetIdentity }),
  createChannel: (serverId: number, name: string, kind: 'Text' | 'Voice', moderatorOnly: boolean) =>
    spacetimedbClient.call('create_channel', {
      server_id: serverId,
      name,
      kind,
      moderator_only: moderatorOnly,
    }),
  updateChannel: (channelId: number, payload: { name?: string; moderatorOnly?: boolean; position?: number }) =>
    spacetimedbClient.call('update_channel', {
      channel_id: channelId,
      name: payload.name,
      moderator_only: payload.moderatorOnly,
      position: payload.position,
    }),
  deleteChannel: (channelId: number) => spacetimedbClient.call('delete_channel', { channel_id: channelId }),
  sendMessage: (channelId: number, content: string) =>
    spacetimedbClient.call('send_message', { channel_id: channelId, content }),
  editMessage: (messageId: number, newContent: string) =>
    spacetimedbClient.call('edit_message', { message_id: messageId, new_content: newContent }),
  deleteMessage: (messageId: number) => spacetimedbClient.call('delete_message', { message_id: messageId }),
  joinVoiceChannel: (channelId: number) => spacetimedbClient.call('join_voice_channel', { channel_id: channelId }),
  leaveVoiceChannel: (channelId: number) => spacetimedbClient.call('leave_voice_channel', { channel_id: channelId }),
  updateVoiceState: (
    channelId: number,
    muted: boolean,
    deafened: boolean,
    sharingScreen: boolean,
    sharingCamera: boolean,
  ) =>
    spacetimedbClient.call('update_voice_state', {
      channel_id: channelId,
      muted,
      deafened,
      sharing_screen: sharingScreen,
      sharing_camera: sharingCamera,
    }),
  sendFriendRequest: (targetIdentity: Identity) =>
    spacetimedbClient.call('send_friend_request', { target_identity: targetIdentity }),
  acceptFriendRequest: (requesterIdentity: Identity) =>
    spacetimedbClient.call('accept_friend_request', { requester_identity: requesterIdentity }),
  declineFriendRequest: (requesterIdentity: Identity) =>
    spacetimedbClient.call('decline_friend_request', { requester_identity: requesterIdentity }),
  removeFriend: (otherIdentity: Identity) => spacetimedbClient.call('remove_friend', { other_identity: otherIdentity }),
  blockUser: (targetIdentity: Identity) => spacetimedbClient.call('block_user', { target_identity: targetIdentity }),
  unblockUser: (targetIdentity: Identity) => spacetimedbClient.call('unblock_user', { target_identity: targetIdentity }),
  sendDirectMessage: (recipientIdentity: Identity, content: string) =>
    spacetimedbClient.call('send_direct_message', { recipient_identity: recipientIdentity, content }),
  deleteDirectMessage: (messageId: number) =>
    spacetimedbClient.call('delete_direct_message', { message_id: messageId }),
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

export function handleIncomingMessage(channelId: number, senderIsSelf: boolean): void {
  const ui = useUiStore.getState()
  if (senderIsSelf) return
  if (ui.activeChannelId !== channelId) {
    ui.incrementUnread(channelId)
    const totalUnread = Object.values(useUiStore.getState().unreadByChannel).reduce((sum, value) => sum + value, 0)
    void tauriCommands.setBadgeCount(totalUnread).catch(() => undefined)
    void tauriCommands
      .showNotification('New Message', `Unread message in channel ${channelId}`)
      .catch(() => undefined)
  }
}

export function handleIncomingFriendRequest(username: string): void {
  void tauriCommands
    .showNotification('Friend Request', `New friend request from ${username}`)
    .catch(() => undefined)
}

export function handleFriendAccepted(username: string): void {
  void tauriCommands
    .showNotification('Friend Request Accepted', `${username} accepted your friend request`)
    .catch(() => undefined)
}
