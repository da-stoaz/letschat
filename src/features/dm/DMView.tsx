import { useEffect, useState } from 'react'
import { reducers } from '../../lib/spacetimedb'
import { useDmStore } from '../../stores/dmStore'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { ChatComposer } from '../chat/ChatComposer'
import { DmVoicePanel } from './DmVoicePanel'
import { PresenceDot } from '@/components/user/PresenceDot'
import type { DirectMessage, Identity } from '../../types/domain'
import { warnOnce } from '../../lib/devWarnings'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'

const EMPTY_DM_MESSAGES: DirectMessage[] = []

function toInitials(identity: string): string {
  return identity.replace(/^0x/, '').slice(0, 2).toUpperCase()
}

function DMMessageCard({ message }: { message: DirectMessage }) {
  const sender = useUserPresentation(message.senderIdentity)

  return (
    <article className="rounded-xl border border-border/70 bg-background/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar className="size-7 rounded-lg">
            {sender.avatarUrl ? <AvatarImage src={sender.avatarUrl} alt={sender.displayName} /> : null}
            <AvatarFallback className="rounded-lg bg-secondary text-xs">{toInitials(message.senderIdentity)}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">{sender.displayName}</span>
          <PresenceDot status={sender.status} className="size-1.5" />
        </div>
        <Badge variant="secondary">{new Date(message.sentAt).toLocaleTimeString()}</Badge>
      </div>
      <p className="text-sm">{message.content}</p>
    </article>
  )
}

export function DMView({ partnerIdentity }: { partnerIdentity: Identity }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const conversations = useDmStore((s) => s.conversations)
  const messages = conversations[partnerIdentity] ?? EMPTY_DM_MESSAGES
  const partner = useUserPresentation(partnerIdentity)

  useEffect(() => {
    if (messages !== EMPTY_DM_MESSAGES) return
    warnOnce(
      `missing_dm_messages_${partnerIdentity}`,
      `[zustand-stability] Missing DM array for ${partnerIdentity}; using stable EMPTY_DM_MESSAGES fallback.`,
    )
  }, [messages, partnerIdentity])

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border/70 bg-card/60">
      <header className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <Avatar className="size-8 rounded-lg">
          {partner.avatarUrl ? <AvatarImage src={partner.avatarUrl} alt={partner.displayName} /> : null}
          <AvatarFallback className="rounded-lg bg-primary/15 text-xs">{toInitials(partnerIdentity)}</AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium">{partner.displayName}</p>
            <PresenceDot status={partner.status} />
          </div>
          <p className="text-xs text-muted-foreground">Direct conversation with @{partner.username}</p>
        </div>
      </header>

      <div className="border-b border-border/70 p-3">
        <DmVoicePanel partnerIdentity={partnerIdentity} />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {messages.map((msg) => (
            <DMMessageCard key={msg.id} message={msg} />
          ))}
        </div>
      </ScrollArea>

      <Separator />

      <ChatComposer
        value={draft}
        onChange={setDraft}
        placeholder={`Message @${partner.username}`}
        error={error}
        onSubmit={async (trimmed) => {
          setError(null)
          try {
            await reducers.sendDirectMessage(partnerIdentity, trimmed)
            setDraft('')
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not send direct message.'
            setError(message)
          }
        }}
      />
    </section>
  )
}
