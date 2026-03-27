import { DmChannelBar } from './channel-bar/DmChannelBar'
import { ServerChannelBar } from './channel-bar/ServerChannelBar'
import type { ChannelBarProps } from './channel-bar/types'

export type { ChannelBarProps } from './channel-bar/types'

export function ChannelBar({
  channelBarWidth,
  activeServerId,
  activeServer,
  activeChannelId,
  role,
  textChannels,
  voiceChannels,
  activeChannelsCount,
  unreadByChannel,
  participantsByChannel,
  joinedVoiceChannelId,
  normalizedSelfIdentity,
  memberProfileByIdentity,
  onOpenRenameServer,
  onOpenInvite,
  onOpenCreateChannel,
  onSelectChannel,
  onOpenFriends,
  dmContacts,
  activeDmIdentity,
  dmCallActiveByIdentity,
  onOpenDmContact,
}: ChannelBarProps) {
  if (activeServerId) {
    return (
      <ServerChannelBar
        activeServer={activeServer}
        activeChannelId={activeChannelId}
        role={role}
        textChannels={textChannels}
        voiceChannels={voiceChannels}
        activeChannelsCount={activeChannelsCount}
        unreadByChannel={unreadByChannel}
        participantsByChannel={participantsByChannel}
        joinedVoiceChannelId={joinedVoiceChannelId}
        normalizedSelfIdentity={normalizedSelfIdentity}
        memberProfileByIdentity={memberProfileByIdentity}
        onOpenRenameServer={onOpenRenameServer}
        onOpenInvite={onOpenInvite}
        onOpenCreateChannel={onOpenCreateChannel}
        onSelectChannel={onSelectChannel}
      />
    )
  }

  return (
      <DmChannelBar
      channelBarWidth={channelBarWidth}
      dmContacts={dmContacts}
      activeDmIdentity={activeDmIdentity}
      dmCallActiveByIdentity={dmCallActiveByIdentity}
      onOpenFriends={onOpenFriends}
      onOpenDmContact={onOpenDmContact}
    />
  )
}
