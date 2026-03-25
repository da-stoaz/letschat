import { Navigate, useParams } from 'react-router-dom'
import { useChannelsStore } from '../stores/channelsStore'
import { TextChannelView } from '../features/channels/TextChannelView'
import { VoiceChannelView } from '../features/voice/VoiceChannelView'
import { reducers } from '../lib/spacetimedb'

export function ServerChannelPage() {
  const { serverId, channelId } = useParams()
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)

  const serverNumericId = Number(serverId)
  const serverChannels = Number.isFinite(serverNumericId) ? (channelsByServer[serverNumericId] ?? []) : []

  if (!channelId && serverChannels.length > 0) {
    return <Navigate to={`/app/${serverNumericId}/${serverChannels[0].id}`} replace />
  }

  const channel = serverChannels.find((c) => String(c.id) === channelId)

  if (!channel) {
    if (serverChannels.length === 0 && Number.isFinite(serverNumericId)) {
      return (
        <section className="pane-empty">
          <div className="empty-stack">
            <h2>No channels in this server yet</h2>
            <p>Create your first text channel to start chatting.</p>
            <button onClick={() => reducers.createChannel(serverNumericId, 'general', 'Text', false)}>
              Create #general
            </button>
          </div>
        </section>
      )
    }

    return (
      <section className="pane-empty">
        <div className="empty-stack">
          <h2>Channel not found</h2>
          <p>Pick a channel from the sidebar.</p>
        </div>
      </section>
    )
  }
  if (channel.kind === 'Voice') return <VoiceChannelView channelId={channel.id} />
  return <TextChannelView channelId={channel.id} />
}
