import { useState } from 'react'
import { reducers, resetLocalAuthSession } from '../lib/spacetimedb'
import { useConnectionStore } from '../stores/connectionStore'
import { useSelfStore } from '../stores/selfStore'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const user = useSelfStore((s) => s.user)
  const identity = useConnectionStore((s) => s.identity)
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [error, setError] = useState<string | null>(null)

  return (
    <section className="auth-card">
      <h3>Settings</h3>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          try {
            await reducers.updateProfile(displayName || undefined, avatarUrl || undefined)
            onClose()
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not save settings.'
            setError(message)
          }
        }}
      >
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />
        </label>
        <label>
          Avatar URL
          <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="Avatar URL" />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>

      <section className="hint-card">
        <p><strong>Account</strong></p>
        <p>{user ? `@${user.username}` : 'Unregistered identity'}</p>
        <p>{identity ? identity : 'No identity available'}</p>
        <button
          type="button"
          className="danger"
          onClick={() => {
            resetLocalAuthSession()
            window.location.assign('/auth')
          }}
        >
          Sign Out (Reset Local Session)
        </button>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  )
}
