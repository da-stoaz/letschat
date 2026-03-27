import type { UserPresenceStatus } from '../../../hooks/useUserPresentation'
import type { Channel, Role, Server, VoiceParticipant } from '../../../types/domain'

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
  activeServerId: number | null
  activeServer: Server | null
  activeChannelId: number | null
  role: Role | null
  textChannels: Channel[]
  voiceChannels: Channel[]
  activeChannelsCount: number
  unreadByChannel: Record<number, number>
  participantsByChannel: Record<number, VoiceParticipant[]>
  joinedVoiceChannelId: number | null
  normalizedSelfIdentity: string | null
  memberProfileByIdentity: Map<string, { label: string; avatarUrl: string | null }>
  onOpenRenameServer: () => void
  onOpenInvite: () => void
  onOpenCreateChannel: () => void
  onSelectChannel: (channelId: number) => void
  onOpenFriends: () => void
  dmContacts: DmContact[]
  activeDmIdentity: string | null
  dmCallActiveByIdentity: Record<string, boolean>
  onOpenDmContact: (identity: string) => void
}

export interface ServerChannelBarProps {
  activeServer: Server | null
  activeChannelId: number | null
  role: Role | null
  textChannels: Channel[]
  voiceChannels: Channel[]
  activeChannelsCount: number
  unreadByChannel: Record<number, number>
  participantsByChannel: Record<number, VoiceParticipant[]>
  joinedVoiceChannelId: number | null
  normalizedSelfIdentity: string | null
  memberProfileByIdentity: Map<string, { label: string; avatarUrl: string | null }>
  onOpenRenameServer: () => void
  onOpenInvite: () => void
  onOpenCreateChannel: () => void
  onSelectChannel: (channelId: number) => void
}

export interface DmChannelBarProps {
  dmContacts: DmContact[]
  activeDmIdentity: string | null
  dmCallActiveByIdentity: Record<string, boolean>
  onOpenFriends: () => void
  onOpenDmContact: (identity: string) => void
}

