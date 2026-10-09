import { useQuery } from '@tanstack/react-query'
import { loadPinnedChannelMessages } from '../../lib/spacetimedb/history'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMemo, useState } from 'react'
import { PinIcon, PinOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
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
          <span className="shrink-0 text-xs text-muted-foreground">{formatTimestamp(pin.sentAt)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{preview}</p>
      </button>
      {canModerate ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Unpin message"
          className="touch-visible opacity-0 transition-opacity group-hover/pin:opacity-100 group-focus-within/pin:opacity-100"
          onClick={() => onUnpin(pin.messageId)}
        >
          <PinOffIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

export function ChannelPinsPopover({
  channelId,
  pins,
  messages,
  canModerate,
  onJump,
  onUnpin,
  compact = false,
  mobileOpen = false,
  onMobileOpenChange,
}: {
  channelId: number
  pins: PinnedMessage[]
  compact?: boolean
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
  messages: Message[]
  canModerate: boolean
  onJump: (messageId: number) => void
  onUnpin: (messageId: number) => void
}) {
  const [desktopOpen, setDesktopOpen] = useState(false)
  const open = compact ? mobileOpen : desktopOpen
  const setOpen = (next: boolean) => {
    if (compact) onMobileOpenChange?.(next)
    else setDesktopOpen(next)
  }

  const identity = useConnectionStore(s => s.identity)
  const pinContent = useQuery({
    queryKey: ['pinned-content', identity, channelId, pins.map(pin => pin.messageId).join(',')],
    queryFn: () => loadPinnedChannelMessages(channelId),
    enabled: open && pins.some(pin => !messages.some(message => message.id === pin.messageId)),
    retry: false,
  })

  const resolved = useMemo<ResolvedPin[]>(() => {
    const byId = new Map([...(pinContent.data ?? []), ...messages].map((message) => [message.id, message]))
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
  }, [pins, messages, pinContent.data])

  const content = <>
        <div className="max-h-72 overflow-y-auto app-scrollbar">
          {pinContent.isFetching && <p role="status" className="p-2 text-sm text-muted-foreground">Loading pinned messages…</p>}
          {pinContent.isError && <div role="alert" className="p-2 text-sm text-destructive">Could not load pinned messages. <Button size="sm" variant="outline" onClick={() => void pinContent.refetch()}>Retry</Button></div>}
          {resolved.length < pins.length && !pinContent.isFetching && !pinContent.isError && <p className="p-2 text-sm text-muted-foreground">Some pinned content is unavailable.</p>}
          {pins.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No pinned messages yet.
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
  </>
  if (compact) return <Sheet open={open} onOpenChange={setOpen}>
    <SheetContent className="data-[side=right]:w-full sm:max-w-sm">
      <SheetHeader><SheetTitle>Pinned messages</SheetTitle></SheetHeader>
      <div className="min-h-0 overflow-y-auto px-4 pb-4">{content}</div>
    </SheetContent>
  </Sheet>

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
        <h2 className="px-2 text-sm font-medium">Pinned messages</h2>
        {content}
      </PopoverContent>
    </Popover>
  )
}
