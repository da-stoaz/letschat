import {
  Identity as SpacetimeIdentityClass,
  type Identity as SpacetimeIdentity,
  type Timestamp as SpacetimeTimestamp,
} from 'spacetimedb'
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
} from '../../types/domain'

// ─── Type coercion helpers ────────────────────────────────────────────────────

export function toIdentityString(value: unknown): Identity {
  if (value && typeof value === 'object' && 'toHexString' in value) {
    return (value as SpacetimeIdentity).toHexString() as Identity
  }
  return String(value) as Identity
}

export function toU64Number(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return Number(value)
}

export function toIsoString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as SpacetimeTimestamp).toDate().toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  return new Date().toISOString()
}

export function enumTag(value: unknown): string {
  if (value && typeof value === 'object' && 'tag' in value) {
    return String((value as { tag: string }).tag)
  }
  return String(value)
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export function normalizeIdentity(identity: Identity): string {
  return identity.trim().toLowerCase()
}

export function sameIdentity(a: Identity, b: Identity): boolean {
  return normalizeIdentity(a) === normalizeIdentity(b)
}

export function toReducerIdentity(value: Identity | SpacetimeIdentity): SpacetimeIdentityClass {
  if (value && typeof value === 'object' && 'toHexString' in value) {
    return value as SpacetimeIdentityClass
  }
  return new SpacetimeIdentityClass(String(value))
}

// ─── Row field helpers ────────────────────────────────────────────────────────

export type DbRow = Record<string, unknown>

export function rowString(row: DbRow, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : String(value ?? '')
}

export function rowNullableString(row: DbRow, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : value == null ? null : String(value)
}

// ─── Scope key helpers ────────────────────────────────────────────────────────

export function dmReadScopeKey(selfIdentity: Identity, otherIdentity: Identity): string {
  const a = normalizeIdentity(selfIdentity)
  const b = normalizeIdentity(otherIdentity)
  return a <= b ? `dm:${a}:${b}` : `dm:${b}:${a}`
}

// ─── Row → domain mappers ─────────────────────────────────────────────────────

export function mapUser(row: DbRow): User {
  return {
    identity: toIdentityString(row.identity),
    username: rowString(row, 'username'),
    displayName: rowString(row, 'displayName'),
    avatarUrl: rowNullableString(row, 'avatarUrl'),
    createdAt: toIsoString(row.createdAt),
  }
}

export function mapServer(row: DbRow): Server {
  return {
    id: toU64Number(row.id),
    name: rowString(row, 'name'),
    ownerIdentity: toIdentityString(row.ownerIdentity),
    invitePolicy: enumTag(row.invitePolicy || 'ModeratorsOnly') as ServerInvitePolicy,
    iconUrl: rowNullableString(row, 'iconUrl'),
    createdAt: toIsoString(row.createdAt),
  }
}

export function mapServerMember(row: DbRow): ServerMember {
  return {
    serverId: toU64Number(row.serverId),
    userIdentity: toIdentityString(row.userIdentity),
    role: enumTag(row.role) as Role,
    joinedAt: toIsoString(row.joinedAt),
    timeoutUntil: row.timeoutUntil ? toIsoString(row.timeoutUntil) : null,
  }
}

export function mapInvite(row: DbRow): Invite {
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

export function isInviteActive(invite: Invite): boolean {
  const expired = Date.parse(invite.expiresAt) < Date.now()
  const exhausted = invite.maxUses != null && invite.useCount >= invite.maxUses
  return !expired && !exhausted
}

export function mapDmServerInvite(row: DbRow): DmServerInvite {
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

export function mapChannel(row: DbRow): Channel {
  return {
    id: toU64Number(row.id),
    serverId: toU64Number(row.serverId),
    name: rowString(row, 'name'),
    kind: enumTag(row.kind) as ChannelKind,
    position: Number(row.position),
    section: rowNullableString(row, 'section'),
    moderatorOnly: Boolean(row.moderatorOnly),
  }
}

export function mapMessage(row: DbRow): Message {
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

export function mapVoiceParticipant(row: DbRow): VoiceParticipant {
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

export function mapFriend(row: DbRow): Friend {
  return {
    userA: toIdentityString(row.userA),
    userB: toIdentityString(row.userB),
    status: enumTag(row.status) as FriendStatus,
    requestedBy: toIdentityString(row.requestedBy),
    updatedAt: toIsoString(row.updatedAt),
  }
}

export function mapBlock(row: DbRow): Block {
  return {
    blocker: toIdentityString(row.blocker),
    blocked: toIdentityString(row.blocked),
    createdAt: toIsoString(row.createdAt),
  }
}

export function mapDirectMessage(row: DbRow): DirectMessage {
  return {
    id: toU64Number(row.id),
    senderIdentity: toIdentityString(row.senderIdentity),
    recipientIdentity: toIdentityString(row.recipientIdentity),
    content: rowString(row, 'content'),
    sentAt: toIsoString(row.sentAt),
    editedAt: row.editedAt ? toIsoString(row.editedAt) : null,
    deletedBySender: Boolean(row.deletedBySender),
    deletedByRecipient: Boolean(row.deletedByRecipient),
  }
}

export function mapDmVoiceParticipant(row: DbRow): DmVoiceParticipant {
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

export function mapPresenceState(row: DbRow): PresenceState {
  return {
    identity: toIdentityString(row.identity),
    online: Boolean(row.online),
    lastInteractionAt: toIsoString(row.lastInteractionAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

export function mapTypingState(row: DbRow): TypingState {
  return {
    typingKey: rowString(row, 'typingKey'),
    scopeKey: rowString(row, 'scopeKey'),
    userIdentity: toIdentityString(row.userIdentity),
    updatedAt: toIsoString(row.updatedAt),
  }
}

export function mapReadState(row: DbRow): ReadState {
  return {
    readKey: rowString(row, 'readKey'),
    scopeKey: rowString(row, 'scopeKey'),
    userIdentity: toIdentityString(row.userIdentity),
    lastReadAt: toIsoString(row.lastReadAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}
