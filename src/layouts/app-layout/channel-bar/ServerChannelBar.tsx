import { BellIcon, BellOffIcon, ChevronsUpDownIcon, HashIcon, LockIcon, PlusIcon, ShieldIcon, Volume2Icon } from 'lucide-react'
import { canManageChannels, canRenameServer } from '../../../lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { VoiceChannelButton } from '../VoiceChannelButton'
import { ChannelBarShell } from './ChannelBarShell'
import type { ServerChannelBarProps } from './types'

const EMPTY_ACTIVE_SPEAKERS = new Set<string>()

export function ServerChannelBar({
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
}: ServerChannelBarProps) {
  return (
    <ChannelBarShell
      header={(
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex w-full items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60">
            <span className="truncate">{activeServer?.name ?? 'Server'}</span>
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
            <DropdownMenuItem onClick={onToggleServerMute}>
              {isServerMuted ? (
                <>
                  <BellIcon className="size-3.5" />
                  Unmute Server
                </>
              ) : (
                <>
                  <BellOffIcon className="size-3.5" />
                  Mute Server
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              Leave Server (coming soon)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    >
      <ScrollArea className="h-full pr-2">
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Text Channels</h4>
            <HashIcon className="size-3.5 text-muted-foreground" />
          </div>
          {textChannels.map((channel) => {
            const unread = unreadByChannel[channel.id] ?? 0
            const muted = isChannelMuted(channel.id)
            return (
              <div key={channel.id} className="flex items-center gap-1">
                <Button
                  variant={activeChannelId === channel.id ? 'secondary' : 'ghost'}
                  className="min-w-0 flex-1 justify-start gap-2 rounded-lg"
                  onClick={() => onSelectChannel(channel.id)}
                >
                  <HashIcon className="size-4 opacity-70" />
                  <span className="truncate">{channel.name}</span>
                  {channel.moderatorOnly ? <LockIcon className="ml-auto size-3.5 opacity-70" /> : null}
                  {unread > 0 ? <Badge className="ml-auto">{unread}</Badge> : null}
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant={muted ? 'secondary' : 'ghost'}
                  aria-label={muted ? 'Unmute channel' : 'Mute channel'}
                  title={muted ? 'Unmute channel' : 'Mute channel'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleChannelMute(channel.id)
                  }}
                >
                  {muted ? <BellOffIcon className="size-3.5" /> : <BellIcon className="size-3.5" />}
                </Button>
              </div>
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
              activeSpeakerIdentityKeys={joinedVoiceChannelId === channel.id ? activeSpeakerIdentityKeys : EMPTY_ACTIVE_SPEAKERS}
              muted={isChannelMuted(channel.id)}
              memberProfileByIdentity={memberProfileByIdentity}
              onToggleMute={() => onToggleChannelMute(channel.id)}
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
    </ChannelBarShell>
  )
}
