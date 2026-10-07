import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownIcon } from 'lucide-react'
import { MessageBubble, type MessageGroup, type RenderableMessage } from '../channels/MessageBubble'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { getHistoryScrollOffset } from './chatScroll'

const HISTORY_PAGE_SIZE = 50
const GROUP_WINDOW_MS = 7 * 60 * 1000

export interface ChatMessageFeedHandle {
  /** Load (if needed), scroll to, and briefly highlight a message by id. */
  jumpToMessage: (messageId: number) => void
}

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

export const ChatMessageFeed = forwardRef<ChatMessageFeedHandle, {
  scopeKey: string
  messages: RenderableMessage[]
  selfIdentity: string | null
  unreadCount?: number
  canDeleteAny?: boolean
  allowEditOwn?: boolean
  onEditMessage?: (message: RenderableMessage, newContent: string) => Promise<void> | void
  onDeleteMessage: (message: RenderableMessage) => Promise<void> | void
  scrollToBottomToken?: number
  pinnedMessageIds?: Set<number> | null
  onTogglePin?: (message: RenderableMessage, pinned: boolean) => void
  /**
   * Called when the reader scrolls past the oldest message held locally. The
   * subscription only carries a recent window, so this is where the next page
   * of older history gets fetched.
   */
  onLoadOlder?: () => void
}>(function ChatMessageFeed({
  scopeKey,
  messages,
  selfIdentity,
  unreadCount = 0,
  canDeleteAny = false,
  allowEditOwn = true,
  onEditMessage,
  onDeleteMessage,
  scrollToBottomToken = 0,
  pinnedMessageIds = null,
  onTogglePin,
  onLoadOlder,
}, ref) {
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const [jumpRequest, setJumpRequest] = useState(0)
  const pendingJumpRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followBottom = useRef(true)
  const previousLayout = useRef<{ scopeKey: string; firstMessageId: number | undefined; scrollHeight: number; scrollTop: number } | null>(null)

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt)),
    [messages],
  )

  // Adjust-state-during-render: entering a different channel/DM resets
  // pagination before paint instead of one frame late in an effect.
  const [lastScopeKey, setLastScopeKey] = useState(scopeKey)
  const [lastMessageCount, setLastMessageCount] = useState(messages.length)
  if (scopeKey !== lastScopeKey) {
    setLastScopeKey(scopeKey)
    setLastMessageCount(sortedMessages.length)
    setHistoryLimit(HISTORY_PAGE_SIZE)
  } else if (sortedMessages.length !== lastMessageCount) {
    // Keep already loaded messages in the DOM when new messages arrive while
    // reading history, rather than trimming the top of the page underneath it.
    if (lastMessageCount > 0 && sortedMessages.length > lastMessageCount &&
      (!followBottom.current || historyLimit >= lastMessageCount)) {
      setHistoryLimit(previous => previous + sortedMessages.length - lastMessageCount)
    }
    setLastMessageCount(sortedMessages.length)
  }

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

  const scrollToBottom = () => {
    const element = scrollRef.current
    if (!element) return
    followBottom.current = true
    element.scrollTop = element.scrollHeight
    setIsAtBottom(true)
  }

  // ponytail: loaded pages stay mounted; add measured page windowing only if
  // profiling very long histories warrants it.
  // Native layout gives every loaded message its real height before paint.
  // Compensate a prepended page once, instead of correcting estimated heights
  // repeatedly during a WebKit scroll gesture.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const previous = previousLayout.current
    const firstMessageId = visibleMessages[0]?.id
    if (previous?.scopeKey !== scopeKey) followBottom.current = true
    if (followBottom.current) {
      element.scrollTop = element.scrollHeight
    } else if (
      previous?.scopeKey === scopeKey && previous.firstMessageId !== firstMessageId &&
      visibleMessages.some(message => message.id === previous.firstMessageId)
    ) {
      element.scrollTop = getHistoryScrollOffset(previous.scrollTop, previous.scrollHeight, element.scrollHeight)
    }
    previousLayout.current = { scopeKey, firstMessageId, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }
  }, [scopeKey, visibleMessages])

  useLayoutEffect(() => {
    const element = scrollRef.current
    const content = element?.firstElementChild
    if (!element || !content) return
    const observer = new ResizeObserver(() => {
      // Secure URL resolution and image loading can change actual heights.
      // Follow those changes only while the reader is still at the bottom.
      if (followBottom.current) element.scrollTop = element.scrollHeight
      if (previousLayout.current) {
        previousLayout.current.scrollTop = element.scrollTop
        previousLayout.current.scrollHeight = element.scrollHeight
      }
    })
    observer.observe(content)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (scrollToBottomToken === 0) return
    followBottom.current = true
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [scrollToBottomToken])

  // Phase 1: the parent triggers a jump imperatively (from a search-result or
  // pin click). Load the target into the visible window and mark it for the
  // scroll/highlight the Phase-2 effect performs once it's laid out.
  useImperativeHandle(
    ref,
    () => ({
      jumpToMessage: (messageId: number) => {
        const index = sortedMessages.findIndex((message) => message.id === messageId)
        if (index < 0) return
        followBottom.current = false
        const neededLimit = sortedMessages.length - index
        setHistoryLimit((previous) => Math.max(previous, neededLimit))
        setIsAtBottom(false)
        setHighlightedId(messageId)
        setJumpRequest(previous => previous + 1)
        pendingJumpRef.current = messageId
      },
    }),
    [sortedMessages],
  )

  // Phase 2: once the actual message is laid out, scroll to it before paint.
  useLayoutEffect(() => {
    const target = pendingJumpRef.current
    if (target == null) return
    if (!visibleMessages.some(message => message.id === target)) return
    pendingJumpRef.current = null
    const element = scrollRef.current
    const message = element?.querySelector<HTMLElement>(`[data-message-id="${target}"]`)
    if (!element || !message) return
    element.scrollTop += message.getBoundingClientRect().top - element.getBoundingClientRect().top
      - Math.max(0, (element.clientHeight - message.offsetHeight) / 2)
  }, [visibleMessages, jumpRequest])

  useEffect(() => {
    if (highlightedId == null) return
    const timer = setTimeout(() => setHighlightedId(null), 2600)
    return () => clearTimeout(timer)
  }, [highlightedId])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="app-scrollbar h-full overflow-x-hidden overflow-y-auto"
        style={{ overflowAnchor: 'none', overscrollBehavior: 'none' }}
        onKeyDownCapture={(event) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) followBottom.current = false
        }}
        onWheelCapture={(event) => {
          // Stop following on intent, before layout/measurement scroll events.
          if (event.deltaY < 0) {
            followBottom.current = false
          }
        }}
        onScroll={(event) => {
          const target = event.currentTarget
          const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
          const previous = previousLayout.current
          if (previous && target.scrollTop < previous.scrollTop) followBottom.current = false
          else if (distanceFromBottom <= 1) followBottom.current = true
          if (previous) {
            previous.scrollTop = target.scrollTop
            previous.scrollHeight = target.scrollHeight
          }
          const atBottom = distanceFromBottom < 80
          setIsAtBottom((previous) => (previous === atBottom ? previous : atBottom))

          if (target.scrollTop <= 60) {
            if (historyLimit >= sortedMessages.length) {
              // Everything the client holds is on screen — ask for the next
              // page from the module.
              onLoadOlder?.()
            } else {
              setHistoryLimit((previous) => Math.min(sortedMessages.length, previous + HISTORY_PAGE_SIZE))
            }
          }
        }}
      >
        <div>
          {feedItems.map((item) => (
            <div key={item.key}>
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
                  highlightMessageId={highlightedId}
                  pinnedMessageIds={pinnedMessageIds}
                  onTogglePin={onTogglePin}
                  onEditMessage={(message, newContent) => {
                    if (!onEditMessage) return
                    void onEditMessage(message, newContent)
                  }}
                  onDeleteMessage={(message) => {
                    void onDeleteMessage(message)
                  }}
                />
              )}
            </div>
          ))}
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
})
