import { useEffect, useState } from 'react'
import { reducers } from '../../lib/spacetimedb'
import { useDmStore } from '../../stores/dmStore'
import type { DirectMessage, Identity } from '../../types/domain'
import { warnOnce } from '../../lib/devWarnings'

const EMPTY_DM_MESSAGES: DirectMessage[] = []

export function DMView({ partnerIdentity }: { partnerIdentity: Identity }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const conversations = useDmStore((s) => s.conversations)
  const messages = conversations[partnerIdentity] ?? EMPTY_DM_MESSAGES

  useEffect(() => {
    if (messages !== EMPTY_DM_MESSAGES) return
    warnOnce(
      `missing_dm_messages_${partnerIdentity}`,
      `[zustand-stability] Missing DM array for ${partnerIdentity}; using stable EMPTY_DM_MESSAGES fallback.`,
    )
  }, [messages, partnerIdentity])

  return (
    <section className="pane">
      <header className="pane-header">
        <strong>DM with {partnerIdentity.slice(0, 8)}</strong>
      </header>

      <div className="message-list">
        {messages.map((msg) => (
          <article className="message" key={msg.id}>
            <div className="message-meta">
              <strong>{msg.senderIdentity.slice(0, 8)}</strong>
              <span>{new Date(msg.sentAt).toLocaleTimeString()}</span>
            </div>
            <p>{msg.content}</p>
          </article>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!draft.trim()) return
          setError(null)
          try {
            await reducers.sendDirectMessage(partnerIdentity, draft.trim())
            setDraft('')
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not send direct message.'
            setError(message)
          }
        }}
      >
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} />
        <button type="submit">Send DM</button>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  )
}
