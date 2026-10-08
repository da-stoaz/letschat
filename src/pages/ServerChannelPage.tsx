import { CompactBack } from '../components/CompactBack'
import { useEffect } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useChannelsStore } from '../stores/channelsStore'
import { useServersStore } from '../stores/serversStore'
import { useUiStore } from '../stores/uiStore'
import { TextChannelView } from '../features/channels/TextChannelView'
import { VoiceChannelView } from '../features/voice/VoiceChannelView'
import { reducers } from '../lib/spacetimedb'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { HashIcon } from 'lucide-react'

export function ServerChannelPage() {
  const { serverId, channelId } = useParams()
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const setActiveServerId = useServersStore((s) => s.setActiveServerId)
  const activeChannelId = useUiStore((s) => s.activeChannelId)
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)

  const serverNumericId = Number(serverId)
  const serverChannels = Number.isFinite(serverNumericId) ? (channelsByServer[serverNumericId] ?? []) : []
  const routeChannelId = Number(channelId)

  useEffect(() => {
    if (!Number.isFinite(serverNumericId)) return
    setActiveServerId(serverNumericId)
  }, [serverNumericId, setActiveServerId])

  useEffect(() => {
    if (!Number.isFinite(routeChannelId)) return
    setActiveChannelId(routeChannelId)
  }, [routeChannelId, setActiveChannelId])

  if (!channelId && serverChannels.length > 0) {
    const remembered = activeChannelId !== null ? serverChannels.find((candidate) => candidate.id === activeChannelId) : null
    const preferred = remembered ?? serverChannels.find((candidate) => candidate.kind !== 'Voice') ?? serverChannels[0]
    return <Navigate to={`/app/${serverNumericId}/${preferred.id}`} replace />
  }

  const channel = serverChannels.find((c) => String(c.id) === channelId)

  if (!channel) {
    if (serverChannels.length === 0 && Number.isFinite(serverNumericId)) {
      return (
        <Card className="h-full border-border/70 bg-card/70">
          <CardHeader>
            <CompactBack />
            <CardTitle>No channels in this space yet</CardTitle>
            <CardDescription>No channels yet.</CardDescription>
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
          <CompactBack />
          <CardTitle>Channel not found</CardTitle>
          <CardDescription><Link className="underline" to={`/app/${serverNumericId}/channels`}>Channels</Link></CardDescription>
        </CardHeader>
      </Card>
    )
  }
  if (channel.kind === 'Voice') return <VoiceChannelView channelId={channel.id} />
  return <TextChannelView channelId={channel.id} />
}
