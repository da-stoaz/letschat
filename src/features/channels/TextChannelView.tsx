import { useEffect, useMemo, useState } from 'react'
import { HashIcon, PencilIcon, SendHorizonalIcon, Trash2Icon } from 'lucide-react'
import { useMessagesStore } from '../../stores/messagesStore'
import { useUiStore } from '../../stores/uiStore'
import { reducers } from '../../lib/spacetimedb'
import type { Message, u64 } from '../../types/domain'
import { useChannelsStore } from '../../stores/channelsStore'
import { useServerRole } from '../../hooks/useServerRole'
import { warnOnce } from '../../lib/devWarnings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const EMPTY_MESSAGES: Message[] = []

function toInitials(identity: string): string {
  return identity.replace(/^0x/, '').slice(0, 2).toUpperCase()
}

export function TextChannelView({ channelId }: { channelId: u64 | null }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)
  const clearUnread = useUiStore((s) => s.clearUnread)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const messagesByChannel = useMessagesStore((s) => s.messagesByChannel)
  const messages = channelId === null ? EMPTY_MESSAGES : (messagesByChannel[channelId] ?? EMPTY_MESSAGES)

  useEffect(() => {
    if (channelId === null || messages !== EMPTY_MESSAGES) return
    warnOnce(
      `missing_channel_messages_${channelId}`,
      `[zustand-stability] Missing messages array for channel ${channelId}; using stable EMPTY_MESSAGES fallback.`,
    )
  }, [channelId, messages])

  const channel = useMemo(
    () =>
      channelId === null
        ? null
        : Object.values(channelsByServer)
            .flat()
            .find((row) => row.id === channelId) ?? null,
    [channelId, channelsByServer],
  )
  const role = useServerRole(channel?.serverId ?? null)
  const readOnlyForMember = Boolean(channel?.moderatorOnly && role === 'Member')

  const flattened = useMemo(() => [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt)), [messages])

  if (channelId === null) {
    return <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20">Select a text channel</div>
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border/70 bg-card/60">
      <header className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <HashIcon className="size-4 text-muted-foreground" />
          <strong className="font-medium">{channel?.name ?? `channel-${channelId}`}</strong>
          {channel?.moderatorOnly ? <Badge variant="secondary">Moderator only</Badge> : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setActiveChannelId(channelId)
            clearUnread(channelId)
          }}
        >
          Mark Read
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {flattened.map((message) => (
            <article
              className="rounded-xl border border-border/70 bg-background/50 p-3 transition-colors hover:bg-background/70"
              key={message.id}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-primary/15 text-xs">{toInitials(message.senderIdentity)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{message.senderIdentity.slice(0, 10)}</p>
                    <p className="text-xs text-muted-foreground">{new Date(message.sentAt).toLocaleTimeString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {message.editedAt ? <Badge variant="secondary">edited</Badge> : null}
                  <Button size="icon-xs" variant="ghost" disabled>
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button size="icon-xs" variant="ghost" disabled>
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className={message.deleted ? 'text-sm italic text-muted-foreground' : 'text-sm leading-relaxed'}>{message.content}</p>
            </article>
          ))}
        </div>
      </ScrollArea>

      <Separator />

      <form
        className="space-y-2 p-3"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!draft.trim() || readOnlyForMember) return
          setError(null)
          try {
            await reducers.sendMessage(channelId, draft.trim())
            setDraft('')
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not send message.'
            setError(message)
          }
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          maxLength={4000}
          placeholder={readOnlyForMember ? 'This channel is read-only for members' : `Message #${channel?.name ?? 'channel'}`}
          disabled={readOnlyForMember}
          className="min-h-24"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{draft.length >= 3500 ? `${draft.length}/4000` : 'Shift+Enter for newline'}</p>
          <Button type="submit" disabled={readOnlyForMember}>
            <SendHorizonalIcon className="size-4" />
            Send
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </section>
  )
}
