import { BellIcon, BellOffIcon, MessageCircleIcon, Volume2Icon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PresenceDot } from '@/components/user/PresenceDot'
import { normalizeIdentity, userInitials } from '../helpers'
import { ChannelBarShell } from './ChannelBarShell'
import type { DmChannelBarProps } from './types'
import { cn } from '../../../lib/utils'

export function DmChannelBar({
  channelBarWidth,
  dmContacts,
  dmUnreadByIdentity,
  isUserMuted,
  onToggleUserMute,
  activeDmIdentity,
  dmCallActiveByIdentity,
  onOpenFriends,
  onOpenDmContact,
}: DmChannelBarProps) {
  const showInCallText = channelBarWidth >= 320
  const showCallTime = channelBarWidth >= 290

  return (
    <ChannelBarShell header={<CardTitle className="text-base">Direct Messages</CardTitle>}>
      <ScrollArea className="h-full pr-2">
        <div className="space-y-3">
          <Button
            className="h-auto w-full justify-start gap-2 rounded-lg py-2"
            variant={activeDmIdentity === null ? 'secondary' : 'ghost'}
            onClick={onOpenFriends}
          >
            <MessageCircleIcon className="size-4" />
            <span className="truncate">Friends</span>
          </Button>

          <section className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Direct Messages</p>
            </div>

            {dmContacts.length > 0 ? (
              dmContacts.map((contact) => {
                const inCall = Boolean(dmCallActiveByIdentity[contact.identity])
                const unread = dmUnreadByIdentity[normalizeIdentity(contact.identity)] ?? 0
                const muted = isUserMuted(contact.identity)
                const shouldShowTime = contact.lastMessageAt && (!inCall || showCallTime)

                return (
                  <div key={contact.identity} className="flex items-center gap-1">
                    <Button
                      className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-lg py-2 pr-2"
                      variant={activeDmIdentity === contact.identity ? 'secondary' : 'ghost'}
                      onClick={() => onOpenDmContact(contact.identity)}
                    >
                      <Avatar className="size-8 rounded-lg">
                        {contact.avatarUrl ? <AvatarImage src={contact.avatarUrl} alt={contact.label} /> : null}
                        <AvatarFallback className="rounded-lg bg-primary/10 text-[10px]">
                          {userInitials(contact.label)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-medium">{contact.label}</p>
                          <PresenceDot status={contact.status} className="size-1.5 shrink-0" />
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{contact.lastMessagePreview}</p>
                      </div>

                      <div className="ml-1 flex shrink-0 flex-col items-end justify-center gap-1">
                        {shouldShowTime ? (
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {new Date(contact.lastMessageAt as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : null}
                        {inCall ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] text-foreground',
                              !showInCallText && 'px-1',
                            )}
                            title="In call"
                          >
                            <Volume2Icon className="size-3" />
                            {showInCallText ? <span className="leading-none">In Call</span> : null}
                          </span>
                        ) : null}
                        {unread > 0 ? <span className="inline-flex min-w-5 justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">{unread}</span> : null}
                      </div>
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant={muted ? 'secondary' : 'ghost'}
                      aria-label={muted ? 'Unmute user' : 'Mute user'}
                      title={muted ? 'Unmute user' : 'Mute user'}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleUserMute(contact.identity)
                      }}
                    >
                      {muted ? <BellOffIcon className="size-3.5" /> : <BellIcon className="size-3.5" />}
                    </Button>
                  </div>
                )
              })
            ) : (
              <p className="px-1 pt-1 text-xs text-muted-foreground">No active DM conversations yet.</p>
            )}
          </section>
        </div>
      </ScrollArea>
    </ChannelBarShell>
  )
}
