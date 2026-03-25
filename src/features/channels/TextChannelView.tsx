import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMessagesStore } from '../../stores/messagesStore'
import { useUiStore } from '../../stores/uiStore'
import { reducers } from '../../lib/spacetimedb'
import type { Message, u64 } from '../../types/domain'

function paginateMessages(messages: Message[], page: number, pageSize: number): Message[] {
  const start = Math.max(messages.length - (page + 1) * pageSize, 0)
  const end = messages.length - page * pageSize
  return messages.slice(start, end)
}

export function TextChannelView({ channelId }: { channelId: u64 | null }) {
  const [draft, setDraft] = useState('')
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)
  const clearUnread = useUiStore((s) => s.clearUnread)
  const messages = useMessagesStore((s) => (channelId ? s.messagesByChannel[channelId] ?? [] : []))

  const query = useInfiniteQuery({
    queryKey: ['messages', channelId],
    enabled: channelId !== null,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => paginateMessages(messages, pageParam, 50),
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.length < 50) return undefined
      return lastPageParam + 1
    },
  })

  const flattened = useMemo(() => {
    const pages = query.data?.pages ?? []
    return pages.flat().sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  }, [query.data?.pages])

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

        {query.hasNextPage ? (
          <button className="ghost" onClick={() => query.fetchNextPage()}>
            Load older
          </button>
        ) : null}
      </div>

      <form
        className="composer"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!draft.trim()) return
          await reducers.sendMessage(channelId, draft.trim())
          setDraft('')
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          placeholder="Message #channel"
        />
        <button type="submit">Send</button>
      </form>
    </section>
  )
}
