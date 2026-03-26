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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { VoiceChannelButton } from './VoiceChannelButton'
import { ActiveCallCard } from './ActiveCallCard'
import { userInitials } from './helpers'
import type { Channel, Role, Server, VoiceParticipant } from '../../types/domain'

interface DmContact {
  identity: string
  label: string
  username: string
  avatarUrl: string | null
  lastMessagePreview: string
  lastMessageAt: string | null
  online: boolean
}

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
}: ServerSidebarProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col border-border/60 bg-card/80 backdrop-blur max-md:hidden">
      <CardHeader className="shrink-0 space-y-3">
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
              <DropdownMenuItem onClick={onOpenInvite}>
                Invite People
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenCreateChannel} disabled={!role || !canManageChannels(role)}>
                Create Channel
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                Leave Server (coming soon)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <CardTitle className="text-base">Direct Messages</CardTitle>
        )}
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-hidden p-3">
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
                  selfJoined={joinedVoiceChannelId === channel.id}
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
          <ScrollArea className="h-full pr-2">
            <div className="space-y-3">
            <section className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Direct Messages</p>
              </div>
              <Button
                className="h-auto w-full justify-start gap-2 rounded-lg py-2"
                variant={activeDmIdentity === null ? 'secondary' : 'ghost'}
                onClick={onOpenFriends}
              >
                <MessageCircleIcon className="size-4" />
                <span className="truncate">Friends</span>
              </Button>
              {dmContacts.length > 0 ? (
                dmContacts.map((contact) => (
                  <Button
                    key={contact.identity}
                    className="h-auto w-full justify-start gap-2 rounded-lg py-2"
                    variant={activeDmIdentity === contact.identity ? 'secondary' : 'ghost'}
                    onClick={() => onOpenDmContact(contact.identity)}
                  >
                    <Avatar className="size-8 rounded-lg">
                      {contact.avatarUrl ? <AvatarImage src={contact.avatarUrl} alt={contact.label} /> : null}
                      <AvatarFallback className="rounded-lg bg-primary/10 text-[10px]">
                        {userInitials(contact.label)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm">{contact.label}</p>
                        <span className={`size-1.5 rounded-full ${contact.online ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{contact.lastMessagePreview}</p>
                    </div>
                    {contact.lastMessageAt ? (
                      <span className="ml-auto text-[11px] text-muted-foreground">{new Date(contact.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    ) : null}
                    {dmCallActiveByIdentity[contact.identity] ? (
                      <Badge variant="secondary" className="ml-auto gap-1">
                        <Volume2Icon className="size-3" />
                        In Call
                      </Badge>
                    ) : null}
                  </Button>
                ))
              ) : (
                <p className="px-1 pt-1 text-xs text-muted-foreground">No active DM conversations yet.</p>
              )}
            </section>
            </div>
          </ScrollArea>
        )}
      </CardContent>
      <div className="shrink-0 px-3 pb-3">
        <ActiveCallCard />
      </div>
    </Card>
  )
}
