import { Navigate, useParams } from 'react-router-dom'
import { useChannelsStore } from '../stores/channelsStore'
import { TextChannelView } from '../features/channels/TextChannelView'
import { VoiceChannelView } from '../features/voice/VoiceChannelView'
import { reducers } from '../lib/spacetimedb'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { HashIcon } from 'lucide-react'

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
        <Card className="h-full border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>No channels in this server yet</CardTitle>
            <CardDescription>Create your first text channel to start chatting.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => reducers.createChannel(serverNumericId, 'general', 'Text', false)}>
              <HashIcon className="size-4" />
              Create #general
            </Button>
          </CardContent>
        </Card>
      )
    }

    return (
      <Card className="h-full border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Channel not found</CardTitle>
          <CardDescription>Pick a channel from the sidebar.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  if (channel.kind === 'Voice') return <VoiceChannelView channelId={channel.id} />
  return <TextChannelView channelId={channel.id} />
}
