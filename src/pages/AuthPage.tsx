import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { reducers, spacetimedbClient } from '../lib/spacetimedb'
import { useSelfStore } from '../stores/selfStore'

export function AuthPage() {
  const navigate = useNavigate()
  const user = useSelfStore((s) => s.user)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')

  useEffect(() => {
    void spacetimedbClient.connect()
  }, [])

  useEffect(() => {
    if (user) navigate('/app', { replace: true })
  }, [navigate, user])

  return (
    <section className="auth-page">
      <h1>LetsChat</h1>
      <form
        className="auth-card"
        onSubmit={async (event) => {
          event.preventDefault()
          await reducers.registerUser(username.trim(), displayName.trim())
          navigate('/app', { replace: true })
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
      </form>
    </section>
  )
}
