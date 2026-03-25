import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'

export function EditServerModal({ serverId, currentName, onClose }: { serverId: number; currentName: string; onClose: () => void }) {
  const [name, setName] = useState(currentName)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          await reducers.renameServer(serverId, name.trim())
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not rename server.'
          setError(message)
        }
      }}
    >
      <h3>Edit Server</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit">Save</button>
        <button
          className="danger"
          type="button"
          onClick={async () => {
            setError(null)
            try {
              await reducers.deleteServer(serverId)
              onClose()
            } catch (e) {
              const message = e instanceof Error ? e.message : 'Could not delete server.'
              setError(message)
            }
          }}
        >
          Delete Server
        </button>
      </div>
    </form>
  )
}
