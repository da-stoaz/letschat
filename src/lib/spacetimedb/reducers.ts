import { spacetimedbClient } from './connection'
import { toReducerIdentity } from './mappers'
import type { Identity, ServerInvitePolicy } from '../../types/domain'

// ─── Reducer argument helpers ─────────────────────────────────────────────────

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

function toU32(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${fieldName} must be a non-negative 32-bit integer`)
  }
  return value
}

// ─── Typed reducer wrappers ───────────────────────────────────────────────────

export const reducers = {
  registerUser: (username: string, displayName: string) =>
    spacetimedbClient.call('registerUser', { username, displayName }),
  updateProfile: (displayName?: string | null, avatarUrl?: string | null) => {
    const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : null
    let normalizedAvatarUrl: string | null = null
    if (avatarUrl === null) {
      // Server reducer uses Option<String>; an empty string is the explicit clear signal.
      normalizedAvatarUrl = ''
    } else if (typeof avatarUrl === 'string') {
      normalizedAvatarUrl = avatarUrl.trim()
    }
    return spacetimedbClient.call('updateProfile', {
      displayName: normalizedDisplayName && normalizedDisplayName.length > 0 ? normalizedDisplayName : null,
      avatarUrl: normalizedAvatarUrl,
    })
  },
  createServer: (name: string) => spacetimedbClient.call('createServer', { name }),
  renameServer: (serverId: number, newName: string) =>
    spacetimedbClient.call('renameServer', { serverId: toU64(serverId, 'serverId'), newName }),
  setServerIcon: (serverId: number, iconUrl: string | null) =>
    spacetimedbClient.call('setServerIcon', {
      serverId: toU64(serverId, 'serverId'),
      iconUrl: iconUrl === null ? null : iconUrl.trim(),
    }),
  setServerInvitePolicy: (serverId: number, invitePolicy: ServerInvitePolicy) =>
    spacetimedbClient.call('setServerInvitePolicy', {
      serverId: toU64(serverId, 'serverId'),
      invitePolicy: reducerEnum(invitePolicy),
    }),
  deleteServer: (serverId: number) =>
    spacetimedbClient.call('deleteServer', { serverId: toU64(serverId, 'serverId') }),
  leaveServer: (serverId: number) =>
    spacetimedbClient.call('leaveServer', { serverId: toU64(serverId, 'serverId') }),
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
  createChannel: (
    serverId: number,
    name: string,
    kind: 'Text' | 'Voice' | 'Announcement',
    moderatorOnly: boolean,
    section: string | null = null,
  ) =>
    spacetimedbClient.call('createChannel', {
      serverId: toU64(serverId, 'serverId'),
      name,
      kind: reducerEnum(kind),
      section: section === null ? null : section.trim(),
      moderatorOnly,
    }),
  updateChannel: (channelId: number, payload: { name?: string; moderatorOnly?: boolean; position?: number }) =>
    spacetimedbClient.call('updateChannel', {
      channelId: toU64(channelId, 'channelId'),
      name: payload.name ?? null,
      moderatorOnly: payload.moderatorOnly ?? null,
      position: payload.position ?? null,
    }),
  setChannelSection: (channelId: number, section: string | null) =>
    spacetimedbClient.call('setChannelSection', {
      channelId: toU64(channelId, 'channelId'),
      section: section === null ? null : section.trim(),
    }),
  moveChannelTo: (channelId: number, section: string | null, position: number) =>
    spacetimedbClient.call('moveChannelTo', {
      channelId: toU64(channelId, 'channelId'),
      section: section === null ? null : section.trim(),
      position: toU32(position, 'position'),
    }),
  moveChannelRelative: (channelId: number, targetChannelId: number, placeAfter: boolean) =>
    spacetimedbClient.call('moveChannelRelative', {
      channelId: toU64(channelId, 'channelId'),
      targetChannelId: toU64(targetChannelId, 'targetChannelId'),
      placeAfter,
    }),
  moveChannel: (channelId: number, direction: -1 | 1) =>
    spacetimedbClient.call('moveChannel', {
      channelId: toU64(channelId, 'channelId'),
      direction,
    }),
  deleteChannel: (channelId: number) =>
    spacetimedbClient.call('deleteChannel', { channelId: toU64(channelId, 'channelId') }),
  deleteChannelSection: (
    serverId: number,
    section: string | null,
  ) =>
    spacetimedbClient.call('deleteChannelSection', {
      serverId: toU64(serverId, 'serverId'),
      section: section === null ? null : section.trim(),
    }),
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
  editDirectMessage: (messageId: number, newContent: string) =>
    spacetimedbClient.call('editDirectMessage', { messageId: toU64(messageId, 'messageId'), newContent }),
  deleteDirectMessage: (messageId: number) =>
    spacetimedbClient.call('deleteDirectMessage', { messageId: toU64(messageId, 'messageId') }),
}
