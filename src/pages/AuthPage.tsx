import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { reducers, spacetimedbClient } from '../lib/spacetimedb'
import { useSelfStore } from '../stores/selfStore'
import { useConnectionStore } from '../stores/connectionStore'

export function AuthPage() {
  const navigate = useNavigate()
  const user = useSelfStore((s) => s.user)
  const connectionStatus = useConnectionStore((s) => s.status)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) navigate('/app', { replace: true })
  }, [navigate, user])

  useEffect(() => {
    if (connectionStatus !== 'disconnected') return
    void spacetimedbClient.connect()
  }, [connectionStatus])

  return (
    <section className="auth-page">
      <h1>LetsChat</h1>
      <form
        className="auth-card"
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          try {
            await reducers.registerUser(username.trim(), displayName.trim())
            navigate('/app', { replace: true })
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not register user.'
            setError(message)
          }
        }}
      >
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} minLength={2} maxLength={32} required />
        </label>
        <label>
          Display Name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <button type="submit">Continue</button>
        {error ? <p className="error-text">{error}</p> : null}
      </form>
    </section>
  )
}
