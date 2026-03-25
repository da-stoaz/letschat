import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'

export function CreateServerModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          await reducers.createServer(name.trim())
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not create server.'
          setError(message)
        }
      }}
    >
      <h3>Create Server</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit">Create</button>
      </div>
    </form>
  )
}
