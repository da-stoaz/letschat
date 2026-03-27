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
  activeSpeakerIdentityKeys,
  memberProfileByIdentity,
  onOpenRenameServer,
  onOpenInvite,
  onOpenCreateChannel,
  isServerMuted,
  isChannelMuted,
  onToggleServerMute,
  onToggleChannelMute,
  onSelectChannel,
  onOpenFriends,
  dmContacts,
  dmUnreadByIdentity,
  isUserMuted,
  onToggleUserMute,
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
        activeSpeakerIdentityKeys={activeSpeakerIdentityKeys}
        memberProfileByIdentity={memberProfileByIdentity}
        onOpenRenameServer={onOpenRenameServer}
        onOpenInvite={onOpenInvite}
        onOpenCreateChannel={onOpenCreateChannel}
        isServerMuted={isServerMuted}
        isChannelMuted={isChannelMuted}
        onToggleServerMute={onToggleServerMute}
        onToggleChannelMute={onToggleChannelMute}
        onSelectChannel={onSelectChannel}
      />
    )
  }

  return (
      <DmChannelBar
      channelBarWidth={channelBarWidth}
      dmContacts={dmContacts}
      dmUnreadByIdentity={dmUnreadByIdentity}
      isUserMuted={isUserMuted}
      onToggleUserMute={onToggleUserMute}
      activeDmIdentity={activeDmIdentity}
      dmCallActiveByIdentity={dmCallActiveByIdentity}
      onOpenFriends={onOpenFriends}
      onOpenDmContact={onOpenDmContact}
    />
  )
}
