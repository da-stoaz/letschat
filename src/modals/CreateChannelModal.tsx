import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import type { ChannelKind } from '../types/domain'

export function CreateChannelModal({ serverId, onClose }: { serverId: number; onClose: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ChannelKind>('Text')
  const [moderatorOnly, setModeratorOnly] = useState(false)

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault()
        await reducers.createChannel(serverId, name, kind, moderatorOnly)
        onClose()
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
      <button type="submit">Create</button>
    </form>
  )
}
