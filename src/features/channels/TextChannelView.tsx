import { useEffect, useMemo, useState } from 'react'
import { HashIcon, PinIcon, SearchIcon, SidebarIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { useChannelsStore } from '../../stores/channelsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMembersStore } from '../../stores/membersStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { useUiStore } from '../../stores/uiStore'
import { useServerRole } from '../../hooks/useServerRole'
import { warnOnce } from '../../lib/devWarnings'
import { ChatMessageFeed } from '../chat/ChatMessageFeed'
import { ChatComposer } from '../chat/ChatComposer'
import { composeMessageWithAttachments, parseMessageAttachments } from '../chat/attachmentPayload'
import type { Message, u64 } from '../../types/domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const EMPTY_MESSAGES: Message[] = []

export function TextChannelView({ channelId }: { channelId: u64 | null }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scrollToBottomToken, setScrollToBottomToken] = useState(0)

  const selfIdentity = useConnectionStore((s) => s.identity)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const membersByServer = useMembersStore((s) => s.membersByServer)
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
  const typingScopeKey = `channel:${channelId}`

  useEffect(() => {
    if (channelId === null) return
    clearUnread(channelId)
    reducers.markChannelRead(channelId).catch(() => undefined)
  }, [channelId, clearUnread])

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

      <ChatMessageFeed
        scopeKey={`channel:${channelId}`}
        messages={messages}
        selfIdentity={selfIdentity}
        unreadCount={unreadCount}
        canDeleteAny={canModerate}
        onEditMessage={async (message) => {
          const parsed = parseMessageAttachments(message.content)
          const next = window.prompt('Edit message', parsed.text)
          if (next === null) return
          const trimmed = next.trim()
          if (!trimmed && parsed.attachments.length === 0) return
          setError(null)
          try {
            const nextContent = composeMessageWithAttachments(trimmed, parsed.attachments)
            await reducers.editMessage(message.id, nextContent)
          } catch (e) {
            const messageText = e instanceof Error ? e.message : 'Could not edit message.'
            setError(messageText)
            throw e
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
        scrollToBottomToken={scrollToBottomToken}
      />

      <Separator />

      <ChatComposer
        value={draft}
        onChange={setDraft}
        disabled={readOnlyForMember}
        placeholder={readOnlyForMember ? 'This channel is read-only for members' : `Message #${channel?.name ?? 'channel'}`}
        typingScopeKey={typingScopeKey}
        typingIdentity={selfIdentity}
        error={error}
        onSubmit={async ({ text, attachments }) => {
          setError(null)
          try {
            const payload = composeMessageWithAttachments(text, attachments)
            await reducers.sendMessage(channelId, payload)
            setDraft('')
            setActiveChannelId(channelId)
            clearUnread(channelId)
            reducers.markChannelRead(channelId).catch(() => undefined)
            setScrollToBottomToken((current) => current + 1)
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not send message.'
            setError(message)
            throw e
          }
        }}
      />
    </section>
  )
}
