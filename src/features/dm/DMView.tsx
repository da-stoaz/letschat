import { useEffect, useState } from 'react'
import { SendHorizonalIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { useDmStore } from '../../stores/dmStore'
import { DmVoicePanel } from './DmVoicePanel'
import type { DirectMessage, Identity } from '../../types/domain'
import { warnOnce } from '../../lib/devWarnings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'

const EMPTY_DM_MESSAGES: DirectMessage[] = []

function toInitials(identity: string): string {
  return identity.replace(/^0x/, '').slice(0, 2).toUpperCase()
}

export function DMView({ partnerIdentity }: { partnerIdentity: Identity }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const conversations = useDmStore((s) => s.conversations)
  const messages = conversations[partnerIdentity] ?? EMPTY_DM_MESSAGES

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
          <AvatarFallback className="rounded-lg bg-primary/15 text-xs">{toInitials(partnerIdentity)}</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-medium">{partnerIdentity.slice(0, 14)}</p>
          <p className="text-xs text-muted-foreground">Direct conversation</p>
        </div>
      </header>

      <div className="border-b border-border/70 p-3">
        <DmVoicePanel partnerIdentity={partnerIdentity} />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {messages.map((msg) => (
            <article className="rounded-xl border border-border/70 bg-background/50 p-3" key={msg.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Avatar className="size-7 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-secondary text-xs">{toInitials(msg.senderIdentity)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">{msg.senderIdentity.slice(0, 10)}</span>
                </div>
                <Badge variant="secondary">{new Date(msg.sentAt).toLocaleTimeString()}</Badge>
              </div>
              <p className="text-sm">{msg.content}</p>
            </article>
          ))}
        </div>
      </ScrollArea>

      <Separator />

      <form
        className="space-y-2 p-3"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!draft.trim()) return
          setError(null)
          try {
            await reducers.sendDirectMessage(partnerIdentity, draft.trim())
            setDraft('')
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not send direct message.'
            setError(message)
          }
        }}
      >
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} className="min-h-24" />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{draft.length}/4000</p>
          <Button type="submit">
            <SendHorizonalIcon className="size-4" />
            Send DM
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </section>
  )
}
