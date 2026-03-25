import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'

export function EditServerModal({ serverId, currentName, onClose }: { serverId: number; currentName: string; onClose: () => void }) {
  const [name, setName] = useState(currentName)

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault()
        await reducers.renameServer(serverId, name)
        onClose()
      }}
    >
      <h3>Edit Server</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required />
      <button type="submit">Save</button>
      <button
        className="danger"
        type="button"
        onClick={async () => {
          await reducers.deleteServer(serverId)
          onClose()
        }}
      >
        Delete Server
      </button>
    </form>
  )
}
