import type { Channel } from '../../types/domain'
import type { ServerMemberWithUser } from '../../stores/membersStore'

export type MemberActionModal =
  | { kind: 'kick'; member: ServerMemberWithUser }
  | { kind: 'ban'; member: ServerMemberWithUser }
  | { kind: 'timeout'; member: ServerMemberWithUser }
  | { kind: 'setRole'; member: ServerMemberWithUser; newRole: 'Member' | 'Moderator' }
  | { kind: 'transferOwnership'; member: ServerMemberWithUser }
  | { kind: 'banList' }

export type PendingDeleteAction =
  | { kind: 'channel'; channel: Channel }
  | { kind: 'section'; group: { section: string | null; channels: Channel[] } }

export type ChannelGroup = {
  key: string
  section: string | null
  channels: Channel[]
}
