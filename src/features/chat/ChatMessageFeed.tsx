import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownIcon } from 'lucide-react'
import { MessageBubble, type MessageGroup, type RenderableMessage } from '../channels/MessageBubble'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const HISTORY_PAGE_SIZE = 50
const GROUP_WINDOW_MS = 7 * 60 * 1000

type FeedItem =
  | { key: string; type: 'date'; dateLabel: string }
  | { key: string; type: 'group'; group: MessageGroup }

function normalizeIdentity(identity: string | null | undefined): string {
  if (!identity) return ''
  return identity.trim().toLowerCase()
}

function sameIdentity(left: string | null | undefined, right: string | null | undefined): boolean {
  return normalizeIdentity(left) === normalizeIdentity(right)
}

function dayKey(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function formatDayLabel(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
}

function isSameGroup(previous: RenderableMessage, next: RenderableMessage): boolean {
  if (previous.systemKind || next.systemKind) return false
  if (!sameIdentity(previous.senderIdentity, next.senderIdentity)) return false
  if (dayKey(previous.sentAt) !== dayKey(next.sentAt)) return false
  const previousMs = Date.parse(previous.sentAt)
  const nextMs = Date.parse(next.sentAt)
  if (!Number.isFinite(previousMs) || !Number.isFinite(nextMs)) return false
  return nextMs - previousMs <= GROUP_WINDOW_MS
}

function estimateGroupHeight(group: MessageGroup): number {
  return 48 + group.messages.length * 28
}

export function ChatMessageFeed({
  scopeKey,
  messages,
  selfIdentity,
  unreadCount = 0,
  canDeleteAny = false,
  allowEditOwn = true,
  onEditMessage,
  onDeleteMessage,
  scrollToBottomToken = 0,
}: {
  scopeKey: string
  messages: RenderableMessage[]
  selfIdentity: string | null
  unreadCount?: number
  canDeleteAny?: boolean
  allowEditOwn?: boolean
  onEditMessage?: (message: RenderableMessage) => Promise<void> | void
  onDeleteMessage: (message: RenderableMessage) => Promise<void> | void
  scrollToBottomToken?: number
}) {
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt)),
    [messages],
  )

  useEffect(() => {
    setHistoryLimit(HISTORY_PAGE_SIZE)
  }, [scopeKey])

  const visibleMessages = useMemo(() => {
    if (historyLimit >= sortedMessages.length) return sortedMessages
    return sortedMessages.slice(sortedMessages.length - historyLimit)
  }, [historyLimit, sortedMessages])

  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = []
    let currentDay: string | null = null
    let currentGroup: MessageGroup | null = null

    for (const message of visibleMessages) {
      const messageDay = dayKey(message.sentAt)
      if (messageDay !== currentDay) {
        currentDay = messageDay
        currentGroup = null
        items.push({
          key: `date-${messageDay}`,
          type: 'date',
          dateLabel: formatDayLabel(message.sentAt),
        })
      }

      if (!currentGroup || !isSameGroup(currentGroup.messages[currentGroup.messages.length - 1], message)) {
        currentGroup = {
          id: `group-${message.id}`,
          senderIdentity: message.senderIdentity,
          messages: [message],
        }
        items.push({
          key: currentGroup.id,
          type: 'group',
          group: currentGroup,
        })
      } else {
        currentGroup.messages.push(message)
      }
    }

    return items
  }, [visibleMessages])

  const rowVirtualizer = useVirtualizer({
    count: feedItems.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => feedItems[index]?.key ?? index,
    estimateSize: (index) => {
      const item = feedItems[index]
      if (!item) return 80
      if (item.type === 'date') return 36
      return estimateGroupHeight(item.group)
    },
    measureElement: (element) => element?.getBoundingClientRect().height ?? 0,
    overscan: 8,
  })

  const scrollToBottom = () => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    setIsAtBottom(true)
  }

  useEffect(() => {
    if (!isAtBottom) return
    requestAnimationFrame(() => scrollToBottom())
  }, [feedItems.length, isAtBottom])

  useEffect(() => {
    if (scrollToBottomToken === 0) return
    requestAnimationFrame(() => scrollToBottom())
  }, [scrollToBottomToken])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="app-scrollbar h-full overflow-x-hidden overflow-y-auto"
        onScroll={(event) => {
          const target = event.currentTarget
          const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80
          setIsAtBottom((previous) => (previous === atBottom ? previous : atBottom))

          if (target.scrollTop <= 60) {
            setHistoryLimit((previous) => {
              const next = Math.min(sortedMessages.length, previous + HISTORY_PAGE_SIZE)
              return next === previous ? previous : next
            })
          }
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = feedItems[virtualRow.index]
            if (!item) return null

            return (
              <div
                key={item.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.type === 'date' ? (
                  <div className="my-1.5 flex items-center gap-2 px-4">
                    <Separator className="flex-1" />
                    <span className="text-xs text-muted-foreground">{item.dateLabel}</span>
                    <Separator className="flex-1" />
                  </div>
                ) : (
                  <MessageBubble
                    group={item.group}
                    canModerate={canDeleteAny}
                    allowEditOwn={allowEditOwn}
                    selfIdentity={selfIdentity}
                    onEditMessage={(message) => {
                      if (!onEditMessage) return
                      void onEditMessage(message)
                    }}
                    onDeleteMessage={(message) => {
                      void onDeleteMessage(message)
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {!isAtBottom ? (
        <Button
          type="button"
          size="sm"
          className="absolute bottom-4 right-4 gap-1.5 rounded-full shadow-lg"
          onClick={scrollToBottom}
        >
          <ArrowDownIcon className="size-4" />
          {unreadCount > 0 ? `${unreadCount} unread` : 'Jump to latest'}
        </Button>
      ) : null}
    </div>
  )
}
