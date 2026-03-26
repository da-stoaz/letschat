import { useEffect, useMemo, useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import { useServerRole } from '../hooks/useServerRole'
import { useChannelsStore } from '../stores/channelsStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useMembersStore } from '../stores/membersStore'
import { useServersStore } from '../stores/serversStore'
import { useUiStore } from '../stores/uiStore'
import { useVoiceSessionStore } from '../stores/voiceSessionStore'
import { useVoiceStore } from '../stores/voiceStore'
import { normalizeIdentity } from './app-layout/helpers'
import { LayoutModals } from './app-layout/LayoutModals'
import { ServerRail } from './app-layout/ServerRail'
import { ServerSidebar } from './app-layout/ServerSidebar'
import { Card, CardContent } from '@/components/ui/card'
import type { Channel } from '../types/domain'

const EMPTY_CHANNELS: Channel[] = []

export function AppLayout() {
  const navigate = useNavigate()
  const params = useParams()
  const [showCreateServer, setShowCreateServer] = useState(false)
  const [showEditServer, setShowEditServer] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const servers = useServersStore((s) => s.servers)
  const setActiveServerId = useServersStore((s) => s.setActiveServerId)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const membersByServer = useMembersStore((s) => s.membersByServer)
  const unreadByChannel = useUiStore((s) => s.unreadByChannel)
  const participantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const joinedVoiceChannelId = useVoiceSessionStore((s) => s.joinedChannelId)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const activeServerId = Number(params.serverId ?? 0) || null
  const activeChannelId = Number(params.channelId ?? 0) || null
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)
  const clearUnread = useUiStore((s) => s.clearUnread)
  const role = useServerRole(activeServerId)
  const normalizedSelfIdentity = selfIdentity ? normalizeIdentity(selfIdentity) : null

  useEffect(() => {
    if (activeServerId !== null) {
      setActiveServerId(activeServerId)
    }
  }, [activeServerId, setActiveServerId])

  useEffect(() => {
    if (activeChannelId !== null) {
      setActiveChannelId(activeChannelId)
    }
  }, [activeChannelId, setActiveChannelId])

  const activeChannels = useMemo(
    () => (activeServerId ? channelsByServer[activeServerId] ?? EMPTY_CHANNELS : EMPTY_CHANNELS),
    [activeServerId, channelsByServer],
  )
  const textChannels = useMemo(
    () => [...activeChannels].filter((c) => c.kind === 'Text').sort((a, b) => a.position - b.position),
    [activeChannels],
  )
  const voiceChannels = useMemo(
    () => [...activeChannels].filter((c) => c.kind === 'Voice').sort((a, b) => a.position - b.position),
    [activeChannels],
  )
  const activeServer = servers.find((server) => server.id === activeServerId) ?? null
  const activeServerMembers = useMemo(
    () => (activeServerId ? membersByServer[activeServerId] ?? [] : []),
    [activeServerId, membersByServer],
  )
  const memberProfileByIdentity = useMemo(() => {
    const map = new Map<string, { label: string; avatarUrl: string | null }>()
    for (const member of activeServerMembers) {
      const key = normalizeIdentity(member.userIdentity)
      const label = member.user?.displayName || member.user?.username || member.userIdentity.slice(0, 10)
      map.set(key, { label, avatarUrl: member.user?.avatarUrl ?? null })
    }
    return map
  }, [activeServerMembers])

  const hasUnreadInServer = (serverId: number) =>
    (channelsByServer[serverId] ?? []).some((channel) => (unreadByChannel[channel.id] ?? 0) > 0)

  const hasVoiceActivityInServer = (serverId: number): boolean => {
    if (!selfIdentity) return false
    const me = normalizeIdentity(selfIdentity)
    const voiceChannelIds = (channelsByServer[serverId] ?? []).filter((channel) => channel.kind === 'Voice').map((channel) => channel.id)
    if (voiceChannelIds.length === 0) return false

    if (joinedVoiceChannelId !== null && voiceChannelIds.includes(joinedVoiceChannelId)) {
      return true
    }

    return voiceChannelIds.some((channelId) =>
      (participantsByChannel[channelId] ?? []).some((participant) => normalizeIdentity(participant.userIdentity) === me),
    )
  }

  const openChannel = (serverId: number, channelId: number) => {
    setActiveServerId(serverId)
    setActiveChannelId(channelId)
    clearUnread(channelId)
    navigate(`/app/${serverId}/${channelId}`)
  }

  const openServer = (serverId: number) => {
    const channels = channelsByServer[serverId] ?? []
    const preferred = channels.find((channel) => channel.kind === 'Text') ?? channels[0]
    if (!preferred) {
      setActiveServerId(serverId)
      navigate(`/app/${serverId}`)
      return
    }
    openChannel(serverId, preferred.id)
  }

  return (
    <>
      <main className="min-h-screen bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/25),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/20),transparent)] p-3 text-foreground">
        <div className="grid h-[calc(100vh-1.5rem)] grid-cols-[72px_290px_minmax(0,1fr)] gap-3 max-md:grid-cols-[72px_minmax(0,1fr)]">
          <ServerRail
            servers={servers}
            activeServerId={activeServerId}
            onOpenHome={() => navigate('/app')}
            onOpenServer={openServer}
            onOpenDm={() => navigate('/app/dm/friends')}
            onOpenCreateServer={() => setShowCreateServer(true)}
            onOpenSettings={() => setShowSettings(true)}
            hasUnreadInServer={hasUnreadInServer}
            hasVoiceActivityInServer={hasVoiceActivityInServer}
          />

          <ServerSidebar
            activeServerId={activeServerId}
            activeServer={activeServer}
            activeChannelId={activeChannelId}
            role={role}
            textChannels={textChannels}
            voiceChannels={voiceChannels}
            activeChannelsCount={activeChannels.length}
            unreadByChannel={unreadByChannel}
            participantsByChannel={participantsByChannel}
            normalizedSelfIdentity={normalizedSelfIdentity}
            memberProfileByIdentity={memberProfileByIdentity}
            onOpenRenameServer={() => setShowEditServer(true)}
            onOpenCreateChannel={() => setShowCreateChannel(true)}
            onSelectChannel={(channelId) => {
              if (activeServerId === null) return
              openChannel(activeServerId, channelId)
            }}
            onOpenFriends={() => navigate('/app/dm/friends')}
          />

          <Card className="border-border/60 bg-card/80 backdrop-blur">
            <CardContent className="h-full p-3">
              <Outlet />
            </CardContent>
          </Card>
        </div>
      </main>

      <LayoutModals
        showCreateServer={showCreateServer}
        showEditServer={showEditServer}
        showCreateChannel={showCreateChannel}
        showSettings={showSettings}
        activeServerId={activeServerId}
        activeServer={activeServer}
        setShowCreateServer={setShowCreateServer}
        setShowEditServer={setShowEditServer}
        setShowCreateChannel={setShowCreateChannel}
        setShowSettings={setShowSettings}
      />
    </>
  )
}
