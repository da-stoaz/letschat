import { useState } from 'react'
import { reducers } from '../../lib/spacetimedb'
import { useDmStore } from '../../stores/dmStore'
import type { Identity } from '../../types/domain'

export function DMView({ partnerIdentity }: { partnerIdentity: Identity }) {
  const [draft, setDraft] = useState('')
  const messages = useDmStore((s) => s.conversations[partnerIdentity] ?? [])

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
          await reducers.sendDirectMessage(partnerIdentity, draft.trim())
          setDraft('')
        }}
      >
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} />
        <button type="submit">Send DM</button>
      </form>
    </section>
  )
}
