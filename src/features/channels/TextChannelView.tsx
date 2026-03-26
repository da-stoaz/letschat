import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownIcon, HashIcon, PinIcon, SearchIcon, SendHorizonalIcon, SidebarIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { useChannelsStore } from '../../stores/channelsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMembersStore } from '../../stores/membersStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { useUiStore } from '../../stores/uiStore'
import { useUsersStore } from '../../stores/usersStore'
import { useServerRole } from '../../hooks/useServerRole'
import { warnOnce } from '../../lib/devWarnings'
import { MessageBubble, type MessageGroup } from './MessageBubble'
import type { Message, u64 } from '../../types/domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

const EMPTY_MESSAGES: Message[] = []
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

function isSameGroup(previous: Message, next: Message): boolean {
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

export function TextChannelView({ channelId }: { channelId: u64 | null }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const selfIdentity = useConnectionStore((s) => s.identity)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const membersByServer = useMembersStore((s) => s.membersByServer)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
  const messagesByChannel = useMessagesStore((s) => s.messagesByChannel)
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)
  const clearUnread = useUiStore((s) => s.clearUnread)
  const unreadByChannel = useUiStore((s) => s.unreadByChannel)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
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
  const canModerate = role === 'Owner' || role === 'Moderator'
  const readOnlyForMember = Boolean(channel?.moderatorOnly && role === 'Member')
  const memberCount = channel?.serverId ? (membersByServer[channel.serverId] ?? []).length : 0
  const unreadCount = channelId === null ? 0 : (unreadByChannel[channelId] ?? 0)

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt)),
    [messages],
  )

  useEffect(() => {
    setHistoryLimit(HISTORY_PAGE_SIZE)
  }, [channelId])

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
    estimateSize: (index) => {
      const item = feedItems[index]
      if (!item) return 80
      if (item.type === 'date') return 36
      return estimateGroupHeight(item.group)
    },
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
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
  }, [draft])

  if (channelId === null) {
    return <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20">Select a text channel</div>
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border/70 bg-card/60">
      <header className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <HashIcon className="size-4 text-muted-foreground" />
          <strong className="font-medium">{channel?.name ?? `channel-${channelId}`}</strong>
          <span className="text-xs text-muted-foreground">{memberCount} members</span>
          {channel?.moderatorOnly ? <Badge variant="secondary">Moderator only</Badge> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" disabled>
            <SearchIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" disabled>
            <PinIcon className="size-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={toggleRightPanel}>
            <SidebarIcon className="size-4" />
            Members
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto"
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
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {item.type === 'date' ? (
                    <div className="my-2 flex items-center gap-2 px-3">
                      <Separator className="flex-1" />
                      <span className="text-xs text-muted-foreground">{item.dateLabel}</span>
                      <Separator className="flex-1" />
                    </div>
                  ) : (
                    <MessageBubble
                      group={item.group}
                      senderLabel={
                        usersByIdentity[item.group.senderIdentity]?.displayName ||
                        usersByIdentity[item.group.senderIdentity]?.username ||
                        item.group.senderIdentity.slice(0, 12)
                      }
                      avatarUrl={usersByIdentity[item.group.senderIdentity]?.avatarUrl ?? null}
                      canModerate={canModerate}
                      selfIdentity={selfIdentity}
                      onEditMessage={async (message) => {
                        const next = window.prompt('Edit message', message.content)
                        if (next === null) return
                        const trimmed = next.trim()
                        if (!trimmed) return
                        setError(null)
                        try {
                          await reducers.editMessage(message.id, trimmed)
                        } catch (e) {
                          const messageText = e instanceof Error ? e.message : 'Could not edit message.'
                          setError(messageText)
                        }
                      }}
                      onDeleteMessage={async (message) => {
                        setError(null)
                        try {
                          await reducers.deleteMessage(message.id)
                        } catch (e) {
                          const messageText = e instanceof Error ? e.message : 'Could not delete message.'
                          setError(messageText)
                        }
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
            setActiveChannelId(channelId)
            clearUnread(channelId)
            requestAnimationFrame(() => scrollToBottom())
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not send message.'
            setError(message)
          }
        }}
      >
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          maxLength={4000}
          placeholder={readOnlyForMember ? 'This channel is read-only for members' : `Message #${channel?.name ?? 'channel'}`}
          disabled={readOnlyForMember}
          className="min-h-12 resize-none overflow-y-auto"
        />
        {readOnlyForMember ? <p className="text-xs text-muted-foreground">This channel is read-only for members.</p> : <p className="text-xs text-muted-foreground">Typing indicator coming soon.</p>}
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

