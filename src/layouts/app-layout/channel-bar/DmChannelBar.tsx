import { MessageCircleIcon, Volume2Icon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PresenceDot } from '@/components/user/PresenceDot'
import { userInitials } from '../helpers'
import { ChannelBarShell } from './ChannelBarShell'
import type { DmChannelBarProps } from './types'

export function DmChannelBar({
  dmContacts,
  activeDmIdentity,
  dmCallActiveByIdentity,
  onOpenFriends,
  onOpenDmContact,
}: DmChannelBarProps) {
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
                      <PresenceDot status={contact.status} className="size-1.5" />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{contact.lastMessagePreview}</p>
                  </div>
                  {contact.lastMessageAt ? (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {new Date(contact.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
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
    </ChannelBarShell>
  )
}

