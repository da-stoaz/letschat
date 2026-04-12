import type { UserPresenceStatus } from '../../../hooks/useUserPresentation'
import type { Channel, Identity, Role, Server, VoiceParticipant } from '../../../types/domain'

export interface DmContact {
  identity: string
  label: string
  username: string
  avatarUrl: string | null
  lastMessagePreview: string
  lastMessageAt: string | null
  status: UserPresenceStatus
}

export interface ChannelBarProps {
  channelBarWidth: number
  activeServerId: number | null
  activeServer: Server | null
  activeChannelId: number | null
  role: Role | null
  channels: Channel[]
  activeChannelsCount: number
  unreadByChannel: Record<number, number>
  participantsByChannel: Record<number, VoiceParticipant[]>
  joinedVoiceChannelId: number | null
  activeSpeakerIdentityKeys: Set<string>
  memberProfileByIdentity: Map<string, { label: string; avatarUrl: string | null }>
  onOpenInvite: () => void
  onOpenCreateChannel: () => void
  onOpenServerPanel: () => void
  onLeaveServer: () => void
  isChannelMuted: (channelId: number) => boolean
  onToggleChannelMute: (channelId: number) => void
  onSelectChannel: (channelId: number) => void
  onOpenFriends: () => void
  dmContacts: DmContact[]
  dmUnreadByIdentity: Record<Identity, number>
  isUserMuted: (identity: Identity) => boolean
  onToggleUserMute: (identity: Identity) => void
  activeDmIdentity: string | null
  dmCallActiveByIdentity: Record<string, boolean>
  onOpenDmContact: (identity: string) => void
}

export interface ServerChannelBarProps {
  activeServer: Server | null
  activeChannelId: number | null
  role: Role | null
  channels: Channel[]
  activeChannelsCount: number
  unreadByChannel: Record<number, number>
  participantsByChannel: Record<number, VoiceParticipant[]>
  joinedVoiceChannelId: number | null
  activeSpeakerIdentityKeys: Set<string>
  memberProfileByIdentity: Map<string, { label: string; avatarUrl: string | null }>
  onOpenInvite: () => void
  onOpenCreateChannel: () => void
  onOpenServerPanel: () => void
  onLeaveServer: () => void
  isChannelMuted: (channelId: number) => boolean
  onToggleChannelMute: (channelId: number) => void
  onSelectChannel: (channelId: number) => void
}

export interface DmChannelBarProps {
  channelBarWidth: number
  dmContacts: DmContact[]
  dmUnreadByIdentity: Record<Identity, number>
  isUserMuted: (identity: Identity) => boolean
  onToggleUserMute: (identity: Identity) => void
  activeDmIdentity: string | null
  dmCallActiveByIdentity: Record<string, boolean>
  onOpenFriends: () => void
  onOpenDmContact: (identity: string) => void
}
