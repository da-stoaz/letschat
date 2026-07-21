import { useMemo, useState } from 'react'
import { PinIcon, PinOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { parseMessageAttachments } from '../chat/attachmentPayload'
import type { Message, PinnedMessage } from '../../types/domain'

interface ResolvedPin {
  pinId: number
  messageId: number
  senderIdentity: string
  sentAt: string
  text: string
  attachmentCount: number
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function PinRow({
  pin,
  canModerate,
  onJump,
  onUnpin,
}: {
  pin: ResolvedPin
  canModerate: boolean
  onJump: (messageId: number) => void
  onUnpin: (messageId: number) => void
}) {
  const author = useUserPresentation(pin.senderIdentity)
  const preview =
    pin.text.trim().length > 0
      ? pin.text
      : pin.attachmentCount > 0
        ? `${pin.attachmentCount} attachment${pin.attachmentCount === 1 ? '' : 's'}`
        : '(no text)'

  return (
    <div className="group/pin flex items-start gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60">
      <button type="button" onClick={() => onJump(pin.messageId)} className="min-w-0 flex-1 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold">{author.displayName}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{formatTimestamp(pin.sentAt)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{preview}</p>
      </button>
      {canModerate ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Unpin message"
          className="opacity-0 transition-opacity group-hover/pin:opacity-100"
          onClick={() => onUnpin(pin.messageId)}
        >
          <PinOffIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

export function ChannelPinsPopover({
  pins,
  messages,
  canModerate,
  onJump,
  onUnpin,
}: {
  pins: PinnedMessage[]
  messages: Message[]
  canModerate: boolean
  onJump: (messageId: number) => void
  onUnpin: (messageId: number) => void
}) {
  const [open, setOpen] = useState(false)

  const resolved = useMemo<ResolvedPin[]>(() => {
    const byId = new Map(messages.map((message) => [message.id, message]))
    const rows: ResolvedPin[] = []
    for (const pin of pins) {
      const message = byId.get(pin.messageId)
      if (!message || message.deleted) continue
      const parsed = parseMessageAttachments(message.content)
      rows.push({
        pinId: pin.pinId,
        messageId: pin.messageId,
        senderIdentity: message.senderIdentity,
        sentAt: message.sentAt,
        text: parsed.text,
        attachmentCount: parsed.attachments.length,
      })
    }
    return rows
  }, [pins, messages])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label="Pinned messages">
            <PinIcon className="size-3.5" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 gap-1.5">
        <div className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
          Pinned messages{resolved.length > 0 ? ` · ${resolved.length}` : ''}
        </div>
        <div className="max-h-72 overflow-y-auto app-scrollbar">
          {resolved.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No pinned messages yet.
              {canModerate ? ' Hover a message and use the pin icon to add one.' : ''}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {resolved.map((pin) => (
                <PinRow
                  key={pin.pinId}
                  pin={pin}
                  canModerate={canModerate}
                  onJump={(messageId) => {
                    onJump(messageId)
                    setOpen(false)
                  }}
                  onUnpin={onUnpin}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
