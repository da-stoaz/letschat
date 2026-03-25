import { useEffect, useMemo, useState } from 'react'
import { useMessagesStore } from '../../stores/messagesStore'
import { useUiStore } from '../../stores/uiStore'
import { reducers } from '../../lib/spacetimedb'
import type { Message, u64 } from '../../types/domain'
import { useChannelsStore } from '../../stores/channelsStore'
import { useServerRole } from '../../hooks/useServerRole'
import { warnOnce } from '../../lib/devWarnings'

const EMPTY_MESSAGES: Message[] = []

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

  const flattened = useMemo(() => {
    return [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  }, [messages])

  if (channelId === null) {
    return <div className="pane-empty">Select a text channel</div>
  }

  return (
    <section className="pane">
      <header className="pane-header">
        <div>
          <strong># channel-{channelId}</strong>
          <small> Live chat</small>
        </div>
        <button
          onClick={() => {
            setActiveChannelId(channelId)
            clearUnread(channelId)
          }}
        >
          Mark Read
        </button>
      </header>

      <div className="message-list">
        {flattened.map((message) => (
          <article className="message" key={message.id}>
            <div className="message-meta">
              <strong>{message.senderIdentity.slice(0, 8)}</strong>
              <span>{new Date(message.sentAt).toLocaleTimeString()}</span>
              {message.editedAt ? <em>[edited]</em> : null}
            </div>
            <p className={message.deleted ? 'message-deleted' : ''}>{message.content}</p>
          </article>
        ))}

      </div>

      <form
        className="composer"
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
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          maxLength={4000}
          placeholder={readOnlyForMember ? 'This channel is read-only for members' : 'Message #channel'}
          disabled={readOnlyForMember}
        />
        {draft.length >= 3500 ? <small>{draft.length}/4000</small> : null}
        <button type="submit">Send</button>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  )
}
