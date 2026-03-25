import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useChannelsStore } from '../stores/channelsStore'
import { TextChannelView } from '../features/channels/TextChannelView'
import { VoiceChannelView } from '../features/voice/VoiceChannelView'

export function ServerChannelPage() {
  const { channelId } = useParams()
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const allChannels = Object.values(channelsByServer).flat()
  const channel = useMemo(() => allChannels.find((c) => String(c.id) === channelId), [allChannels, channelId])

  if (!channel) return <div className="pane-empty">Channel not found</div>
  if (channel.kind === 'Voice') return <VoiceChannelView channelId={channel.id} />
  return <TextChannelView channelId={channel.id} />
}
