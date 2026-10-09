import { useEffect, useMemo, useRef, useState } from 'react'
import { HashIcon, SidebarIcon, MoreHorizontalIcon, SearchIcon, PinIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { useChannelsStore } from '../../stores/channelsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMembersStore } from '../../stores/membersStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { usePinsStore } from '../../stores/pinsStore'
import { useUiStore } from '../../stores/uiStore'
import { useServerRole } from '../../hooks/useServerRole'
import { warnOnce } from '../../lib/devWarnings'
import { loadChannelMessage, loadOlderChannelMessages } from '../../lib/spacetimedb/history'
import { ChatMessageFeed, type ChatMessageFeedHandle } from '../chat/ChatMessageFeed'
import { useComposerStore } from '../../stores/composerStore'
import { CompactBack } from '../../components/CompactBack'
import { ChatComposer } from '../chat/ChatComposer'
import { ChannelMessageSearch } from './ChannelMessageSearch'
import { ChannelPinsPopover } from './ChannelPinsPopover'
import { composeMessageWithAttachments } from '../chat/attachmentPayload'
import type { Message, PinnedMessage, u64 } from '../../types/domain'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '../../hooks/use-mobile'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const EMPTY_MESSAGES: Message[] = []
const EMPTY_PINS: PinnedMessage[] = []

export function TextChannelView({ channelId }: { channelId: u64 | null }) {
  const compact = useIsMobile()
  const [panel, setPanel] = useState<'search' | 'pins' | null>(null)
  const scopeKey = `channel:${channelId}`
  const setError = (error: string | null) => useComposerStore.getState().update(scopeKey, { error })
  const scrollToBottomToken = useComposerStore(s => s.drafts[scopeKey]?.sent ?? 0)
  const feedRef = useRef<ChatMessageFeedHandle>(null)
  const [jumpTarget, setJumpTarget] = useState<{ id: number } | null>(null)
  const handledJump = useRef<typeof jumpTarget>(null)
  const jumpToMessageId = async (messageId: number) => {
    if (channelId === null) return
    try {
      if (!useMessagesStore.getState().messagesByChannel[channelId]?.some(row => row.id === messageId)) {
        toast.message('Loading message…', { id: 'pin-jump' })
        await loadChannelMessage(channelId, messageId)
      }
      setJumpTarget({ id: messageId })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load message.', { id: 'pin-jump' })
      return
    }
    toast.dismiss('pin-jump')
  }

  const selfIdentity = useConnectionStore((s) => s.identity)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const membersByServer = useMembersStore((s) => s.membersByServer)
  const messagesByChannel = useMessagesStore((s) => s.messagesByChannel)
  const pinsByChannel = usePinsStore((s) => s.pinsByChannel)
  const clearUnread = useUiStore((s) => s.clearUnread)
  const unreadByChannel = useUiStore((s) => s.unreadByChannel)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const messages = channelId === null ? EMPTY_MESSAGES : (messagesByChannel[channelId] ?? EMPTY_MESSAGES)
  const historyExhausted = useMessagesStore(s => channelId !== null && Boolean(s.historyExhausted[channelId]))
  useEffect(() => {
    if (jumpTarget !== null && handledJump.current !== jumpTarget && messages.some(row => row.id === jumpTarget.id)) {
      feedRef.current?.jumpToMessage(jumpTarget.id)
      handledJump.current = jumpTarget
    }
  }, [jumpTarget, messages])
  const pins = channelId === null ? EMPTY_PINS : (pinsByChannel[channelId] ?? EMPTY_PINS)
  const pinnedMessageIds = useMemo(() => new Set(pins.map((pin) => pin.messageId)), [pins])

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
  const typingScopeKey = `channel:${channelId}`
  const lastMessageId = messages[messages.length - 1]?.id ?? null

  useEffect(() => {
    if (channelId === null) return
    const markRead = () => {
      if (!document.hasFocus()) return
      clearUnread(channelId)
      reducers.markChannelRead(channelId).catch(() => undefined)
    }
    markRead()
    window.addEventListener('focus', markRead)
    return () => window.removeEventListener('focus', markRead)
  }, [channelId, lastMessageId, clearUnread])

  if (channelId === null) {
    return <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20">Select a text channel</div>
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card/40">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2 sm:px-4">
        <CompactBack />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <HashIcon className="size-4 text-muted-foreground" />
          <strong className="truncate font-medium">{channel?.name ?? `channel-${channelId}`}</strong>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{memberCount} members</span>
          {channel?.moderatorOnly ? <Badge variant="secondary" className="hidden sm:inline-flex">Moderator only</Badge> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {compact ? <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Channel actions" />}><MoreHorizontalIcon /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={toggleRightPanel}><SidebarIcon />Members</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPanel('search')}><SearchIcon />Search messages</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPanel('pins')}><PinIcon />Pinned messages</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu> : null}
          <ChannelMessageSearch compact={compact} mobileOpen={panel === 'search'} onMobileOpenChange={(open) => { if (!open) setPanel(null) }} messages={messages} onJump={jumpToMessageId} />
          <ChannelPinsPopover
            channelId={channelId}
            compact={compact}
            mobileOpen={panel === 'pins'}
            onMobileOpenChange={(open) => { if (!open) setPanel(null) }}
            pins={pins}
            messages={messages}
            canModerate={canModerate}
            onJump={jumpToMessageId}
            onUnpin={(messageId) => {
              if (channelId === null) return
              reducers.unpinMessage(channelId, messageId).catch((e) => {
                setError(e instanceof Error ? e.message : 'Could not unpin message.')
              })
            }}
          />
          {!compact ? <Button variant="outline" size="sm" className="h-8" onClick={toggleRightPanel}>
            <SidebarIcon className="size-4" />
            Members
          </Button> : null}
        </div>
      </header>

      <ChatMessageFeed
        key={scopeKey}
        ref={feedRef}
        scopeKey={`channel:${channelId}`}
        messages={messages}
        onLoadOlder={() => loadOlderChannelMessages(channelId)}
        historyExhausted={historyExhausted}
        selfIdentity={selfIdentity}
        unreadCount={unreadCount}
        canDeleteAny={canModerate}
        onEditMessage={async (message, newContent) => {
          await reducers.editMessage(message.id, newContent)
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
        scrollToBottomToken={scrollToBottomToken}
        pinnedMessageIds={pinnedMessageIds}
        onTogglePin={
          canModerate
            ? (message, pinned) => {
                setError(null)
                const action = pinned
                  ? reducers.pinMessage(channelId, message.id)
                  : reducers.unpinMessage(channelId, message.id)
                action.catch((e) => {
                  setError(e instanceof Error ? e.message : 'Could not update pin.')
                })
              }
            : undefined
        }
      />

      <ChatComposer
        key={scopeKey}
        scopeKey={scopeKey}
        disabled={readOnlyForMember}
        placeholder={readOnlyForMember ? 'This channel is read-only for members' : `Message #${channel?.name ?? 'channel'}`}
        uploadScope={{ kind: 'channel', channelId }}
        typingScopeKey={typingScopeKey}
        typingIdentity={selfIdentity}
        onSubmit={async ({ text, attachments }) => {
          if (channelId === null) return
          await reducers.sendMessage(channelId, composeMessageWithAttachments(text, attachments))
        }}
      />
    </section>
  )
}
