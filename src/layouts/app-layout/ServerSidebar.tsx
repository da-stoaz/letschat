import { ChevronsUpDownIcon, HashIcon, LockIcon, MessageCircleIcon, PlusIcon, ShieldIcon, Volume2Icon } from 'lucide-react'
import { canManageChannels, canRenameServer } from '../../lib/permissions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { VoiceChannelButton } from './VoiceChannelButton'
import type { Channel, Role, Server, VoiceParticipant } from '../../types/domain'

interface ServerSidebarProps {
  activeServerId: number | null
  activeServer: Server | null
  activeChannelId: number | null
  role: Role | null
  textChannels: Channel[]
  voiceChannels: Channel[]
  activeChannelsCount: number
  unreadByChannel: Record<number, number>
  participantsByChannel: Record<number, VoiceParticipant[]>
  normalizedSelfIdentity: string | null
  memberProfileByIdentity: Map<string, { label: string; avatarUrl: string | null }>
  onOpenRenameServer: () => void
  onOpenCreateChannel: () => void
  onSelectChannel: (channelId: number) => void
  onOpenFriends: () => void
}

export function ServerSidebar({
  activeServerId,
  activeServer,
  activeChannelId,
  role,
  textChannels,
  voiceChannels,
  activeChannelsCount,
  unreadByChannel,
  participantsByChannel,
  normalizedSelfIdentity,
  memberProfileByIdentity,
  onOpenRenameServer,
  onOpenCreateChannel,
  onSelectChannel,
  onOpenFriends,
}: ServerSidebarProps) {
  return (
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
              <DropdownMenuItem onClick={onOpenRenameServer} disabled={!role || !canRenameServer(role)}>
                Rename Server
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenCreateChannel} disabled={!role || !canManageChannels(role)}>
                Create Channel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <CardTitle className="text-base">Direct Messages</CardTitle>
        )}
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
                    onClick={() => onSelectChannel(channel.id)}
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
                <VoiceChannelButton
                  key={channel.id}
                  channel={channel}
                  active={activeChannelId === channel.id}
                  participants={participantsByChannel[channel.id] ?? []}
                  normalizedSelfIdentity={normalizedSelfIdentity}
                  memberProfileByIdentity={memberProfileByIdentity}
                  onSelect={() => onSelectChannel(channel.id)}
                />
              ))}
            </section>

            {activeChannelsCount === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-border/70 bg-muted/25 p-4 text-sm text-muted-foreground">
                <div className="mb-2 flex items-center gap-2 text-foreground">
                  <ShieldIcon className="size-4" />
                  No channels yet
                </div>
                {role && canManageChannels(role) ? (
                  <Button size="sm" onClick={onOpenCreateChannel}>
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
            <Button className="w-full justify-start" variant="secondary" onClick={onOpenFriends}>
              <MessageCircleIcon className="size-4" />
              Friends
            </Button>
            <p className="pt-2 text-xs text-muted-foreground">Select a friend to open a conversation.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
