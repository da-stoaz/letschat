import { useEffect, useMemo, useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import {
  HashIcon,
  MessageCircleIcon,
  PlusIcon,
  SettingsIcon,
  ShieldIcon,
  Volume2Icon,
  LockIcon,
  ChevronsUpDownIcon,
} from 'lucide-react'
import { useServersStore } from '../stores/serversStore'
import { useChannelsStore } from '../stores/channelsStore'
import { useUiStore } from '../stores/uiStore'
import { useVoiceStore } from '../stores/voiceStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useVoiceSessionStore } from '../stores/voiceSessionStore'
import { CreateServerModal } from '../modals/CreateServerModal'
import { EditServerModal } from '../modals/EditServerModal'
import { CreateChannelModal } from '../modals/CreateChannelModal'
import { SettingsModal } from '../modals/SettingsModal'
import { useServerRole } from '../hooks/useServerRole'
import { canManageChannels, canRenameServer } from '../lib/permissions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import stealthChatLogo from '../../src-tauri/icons/stealthchat-nobg.png'
import type { Channel } from '../types/domain'

const EMPTY_CHANNELS: Channel[] = []

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase()
}

function serverInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'S'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

export function AppLayout() {
  const navigate = useNavigate()
  const params = useParams()
  const [showCreateServer, setShowCreateServer] = useState(false)
  const [showEditServer, setShowEditServer] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const servers = useServersStore((s) => s.servers)
  const setActiveServerId = useServersStore((s) => s.setActiveServerId)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const unreadByChannel = useUiStore((s) => s.unreadByChannel)
  const participantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const joinedVoiceChannelId = useVoiceSessionStore((s) => s.joinedChannelId)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const activeServerId = Number(params.serverId ?? 0) || null
  const activeChannelId = Number(params.channelId ?? 0) || null
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)
  const clearUnread = useUiStore((s) => s.clearUnread)
  const role = useServerRole(activeServerId)

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

  const openServer = (serverId: number) => {
    setActionError(null)
    setActiveServerId(serverId)
    const channels = channelsByServer[serverId] ?? []
    const preferred = channels.find((channel) => channel.kind === 'Text') ?? channels[0]

    if (preferred) {
      setActiveChannelId(preferred.id)
      clearUnread(preferred.id)
      navigate(`/app/${serverId}/${preferred.id}`)
      return
    }

    navigate(`/app/${serverId}`)
  }

  return (
    <>
      <main className="min-h-screen bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/25),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/20),transparent)] p-3 text-foreground">
        <div className="grid h-[calc(100vh-1.5rem)] grid-cols-[72px_290px_minmax(0,1fr)] gap-3 max-md:grid-cols-[72px_minmax(0,1fr)]">
          <Card className="border-border/60 bg-card/80 backdrop-blur">
            <CardContent className="flex h-full flex-col items-center gap-2 p-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="secondary" size="icon" className="relative mt-1 h-11 w-11 rounded-2xl" />
                  }
                  onClick={() => navigate('/app')}
                >
                  <img src={stealthChatLogo} alt="StealthChat" className="h-7 w-7 object-contain" />
                </TooltipTrigger>
                <TooltipContent>Home</TooltipContent>
              </Tooltip>

              <Separator className="my-1" />

              <ScrollArea className="w-full flex-1 px-1">
                <div className="flex flex-col items-center gap-2 py-1">
                  {servers.map((server) => (
                    <Tooltip key={server.id}>
                      <TooltipTrigger
                        render={
                          <Button
                            variant={activeServerId === server.id ? 'default' : 'ghost'}
                            size="icon"
                            className="relative h-11 w-11 rounded-2xl"
                            onClick={() => openServer(server.id)}
                          />
                        }
                      >
                        <Avatar className="h-8 w-8 rounded-xl">
                          <AvatarFallback className="rounded-xl bg-primary/10 text-xs">
                            {serverInitials(server.name)}
                          </AvatarFallback>
                        </Avatar>
                        {hasUnreadInServer(server.id) ? (
                          <span className="absolute right-1 top-1 size-2 rounded-full bg-cyan-400" />
                        ) : null}
                        {hasVoiceActivityInServer(server.id) ? (
                          <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-md">
                            <Volume2Icon className="size-2.5" />
                          </span>
                        ) : null}
                      </TooltipTrigger>
                      <TooltipContent side="right">{server.name}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </ScrollArea>

              <Separator className="my-1" />

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant={activeServerId ? 'ghost' : 'secondary'}
                      size="icon"
                      className="h-10 w-10 rounded-xl"
                      onClick={() => navigate('/app/dm/friends')}
                    />
                  }
                >
                  <MessageCircleIcon className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">Direct Messages</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-xl"
                      onClick={() => setShowCreateServer(true)}
                    />
                  }
                >
                  <PlusIcon className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">Create Server</TooltipContent>
              </Tooltip>

              <div className="flex-1" />

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mb-1 h-10 w-10 rounded-xl"
                      onClick={() => setShowSettings(true)}
                    />
                  }
                >
                  <SettingsIcon className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">Settings</TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/80 backdrop-blur max-md:hidden">
            <CardHeader className="space-y-3">
              {activeServer ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="inline-flex w-full items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60"
                  >
                    <span className="truncate">{activeServer.name}</span>
                    <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuItem
                      onClick={() => setShowEditServer(true)}
                      disabled={!role || !canRenameServer(role)}
                    >
                      Rename Server
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setShowCreateChannel(true)}
                      disabled={!role || !canManageChannels(role)}
                    >
                      Create Channel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <CardTitle className="text-base">Direct Messages</CardTitle>
              )}
              {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}
            </CardHeader>

            <CardContent className="h-[calc(100%-92px)] p-3">
              {activeServerId ? (
                <ScrollArea className="h-full pr-2">
                  <section className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Text Channels</h4>
                      <HashIcon className="size-3.5 text-muted-foreground" />
                    </div>
                    {textChannels.map((channel) => {
                      const unread = unreadByChannel[channel.id] ?? 0
                      return (
                        <Button
                          key={channel.id}
                          variant={activeChannelId === channel.id ? 'secondary' : 'ghost'}
                          className="w-full justify-start gap-2 rounded-lg"
                          onClick={() => {
                            if (activeServerId !== null) setActiveServerId(activeServerId)
                            setActiveChannelId(channel.id)
                            clearUnread(channel.id)
                            navigate(`/app/${activeServerId}/${channel.id}`)
                          }}
                        >
                          <HashIcon className="size-4 opacity-70" />
                          <span className="truncate">{channel.name}</span>
                          {channel.moderatorOnly ? <LockIcon className="ml-auto size-3.5 opacity-70" /> : null}
                          {unread > 0 ? <Badge className="ml-auto">{unread}</Badge> : null}
                        </Button>
                      )
                    })}
                  </section>

                  <Separator className="my-4" />

                  <section className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Voice Channels</h4>
                      <Volume2Icon className="size-3.5 text-muted-foreground" />
                    </div>
                    {voiceChannels.map((channel) => (
                      <Button
                        key={channel.id}
                        variant={activeChannelId === channel.id ? 'secondary' : 'ghost'}
                        className="w-full justify-start gap-2 rounded-lg"
                        onClick={() => {
                          if (activeServerId !== null) setActiveServerId(activeServerId)
                          setActiveChannelId(channel.id)
                          clearUnread(channel.id)
                          navigate(`/app/${activeServerId}/${channel.id}`)
                        }}
                      >
                        <Volume2Icon className="size-4 opacity-70" />
                        <span className="truncate">{channel.name}</span>
                        {channel.moderatorOnly ? <LockIcon className="ml-auto size-3.5 opacity-70" /> : null}
                      </Button>
                    ))}
                  </section>

                  {activeChannels.length === 0 ? (
                    <div className="mt-6 rounded-xl border border-dashed border-border/70 bg-muted/25 p-4 text-sm text-muted-foreground">
                      <div className="mb-2 flex items-center gap-2 text-foreground">
                        <ShieldIcon className="size-4" />
                        No channels yet
                      </div>
                      {role && canManageChannels(role) ? (
                        <Button size="sm" onClick={() => setShowCreateChannel(true)}>
                          <PlusIcon className="size-4" />
                          Create Channel
                        </Button>
                      ) : (
                        'A moderator or owner can create channels.'
                      )}
                    </div>
                  ) : null}
                </ScrollArea>
              ) : (
                <div className="space-y-2">
                  <Button className="w-full justify-start" variant="secondary" onClick={() => navigate('/app/dm/friends')}>
                    <MessageCircleIcon className="size-4" />
                    Friends
                  </Button>
                  <p className="pt-2 text-xs text-muted-foreground">Select a friend to open a conversation.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/80 backdrop-blur">
            <CardContent className="h-full p-3">
              <Outlet />
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={showCreateServer} onOpenChange={setShowCreateServer}>
        <DialogContent className="max-w-md">
          <CreateServerModal onClose={() => setShowCreateServer(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showEditServer && !!activeServer} onOpenChange={setShowEditServer}>
        <DialogContent className="max-w-md">
          {activeServer ? (
            <EditServerModal
              serverId={activeServer.id}
              currentName={activeServer.name}
              onClose={() => setShowEditServer(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateChannel && !!activeServerId} onOpenChange={setShowCreateChannel}>
        <DialogContent className="max-w-md">
          {activeServerId ? <CreateChannelModal serverId={activeServerId} onClose={() => setShowCreateChannel(false)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-md">
          <SettingsModal onClose={() => setShowSettings(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
