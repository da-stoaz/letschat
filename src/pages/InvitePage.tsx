import { useParams } from 'react-router-dom'
import { reducers } from '../lib/spacetimedb'

export function InvitePage() {
  const { token = '' } = useParams()

  return (
    <section className="auth-page">
      <h1>Invite</h1>
      <p>Join via invite token:</p>
      <code>{token}</code>
      <button onClick={() => reducers.useInvite(token)}>Join Server</button>
    </section>
  )
}
