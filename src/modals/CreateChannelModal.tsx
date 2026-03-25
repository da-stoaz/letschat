import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import type { ChannelKind } from '../types/domain'

export function CreateChannelModal({ serverId, onClose }: { serverId: number; onClose: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ChannelKind>('Text')
  const [moderatorOnly, setModeratorOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          await reducers.createChannel(serverId, name.trim(), kind, moderatorOnly)
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not create channel.'
          setError(message)
        }
      }}
    >
      <h3>Create Channel</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} required minLength={1} maxLength={100} />
      <select value={kind} onChange={(e) => setKind(e.target.value as ChannelKind)}>
        <option value="Text">Text</option>
        <option value="Voice">Voice</option>
      </select>
      <label>
        <input type="checkbox" checked={moderatorOnly} onChange={(e) => setModeratorOnly(e.target.checked)} />
        Moderator only
      </label>
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
