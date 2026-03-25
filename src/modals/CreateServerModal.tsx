import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'

export function CreateServerModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault()
        await reducers.createServer(name)
        onClose()
      }}
    >
      <h3>Create Server</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required />
      <button type="submit">Create</button>
    </form>
  )
}
