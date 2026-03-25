export type u64 = number
export type Identity = string

export type Role = 'Member' | 'Moderator' | 'Owner'
export type ChannelKind = 'Text' | 'Voice'
export type FriendStatus = 'Pending' | 'Accepted'

export interface User {
  identity: Identity
  username: string
  displayName: string
  avatarUrl: string | null
  createdAt: string
}

export interface Server {
  id: u64
  name: string
  ownerIdentity: Identity
  iconUrl: string | null
  createdAt: string
}

export interface ServerMember {
  serverId: u64
  userIdentity: Identity
  role: Role
  joinedAt: string
}

export interface Ban {
  serverId: u64
  userIdentity: Identity
  bannedBy: Identity
  reason: string | null
  bannedAt: string
}

export interface Invite {
  token: string
  serverId: u64
  createdBy: Identity
  expiresAt: string
  maxUses: number | null
  useCount: number
}

export interface Channel {
  id: u64
  serverId: u64
  name: string
  kind: ChannelKind
  position: number
  moderatorOnly: boolean
}

export interface Message {
  id: u64
  channelId: u64
  senderIdentity: Identity
  content: string
  sentAt: string
  editedAt: string | null
  deleted: boolean
}

export interface VoiceParticipant {
  channelId: u64
  userIdentity: Identity
  joinedAt: string
  muted: boolean
  deafened: boolean
  sharingScreen: boolean
  sharingCamera: boolean
}

export interface Friend {
  userA: Identity
  userB: Identity
  status: FriendStatus
  requestedBy: Identity
  updatedAt: string
}

export interface Block {
  blocker: Identity
  blocked: Identity
  createdAt: string
}

export interface DirectMessage {
  id: u64
  senderIdentity: Identity
  recipientIdentity: Identity
  content: string
  sentAt: string
  deletedBySender: boolean
  deletedByRecipient: boolean
}
