import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault()
        await reducers.updateProfile(displayName || undefined, avatarUrl || undefined)
        onClose()
      }}
    >
      <h3>Settings</h3>
      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />
      <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="Avatar URL" />
      <button type="submit">Save</button>
    </form>
  )
}
