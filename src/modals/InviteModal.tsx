import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'

export function InviteModal({ serverId, onClose }: { serverId: number; onClose: () => void }) {
  const [expiresInSeconds, setExpiresInSeconds] = useState<number | ''>('')
  const [maxUses, setMaxUses] = useState<number | ''>('')

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault()
        await reducers.createInvite(
          serverId,
          expiresInSeconds === '' ? undefined : expiresInSeconds,
          maxUses === '' ? undefined : maxUses,
        )
        onClose()
      }}
    >
      <h3>Create Invite</h3>
      <label>
        Expiration (seconds)
        <input
          type="number"
          value={expiresInSeconds}
          onChange={(e) => setExpiresInSeconds(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </label>
      <label>
        Max uses
        <input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value === '' ? '' : Number(e.target.value))} />
      </label>
      <button type="submit">Create Invite</button>
    </form>
  )
}
