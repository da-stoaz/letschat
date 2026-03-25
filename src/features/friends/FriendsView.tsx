import { useMemo, useState } from 'react'
import { reducers, resolveIdentityFromUsername } from '../../lib/spacetimedb'
import { useFriendsStore } from '../../stores/friendsStore'
import { useConnectionStore } from '../../stores/connectionStore'

type Tab = 'all' | 'pending' | 'blocked'

export function FriendsView() {
  const [tab, setTab] = useState<Tab>('all')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const friends = useFriendsStore((s) => s.friends)
  const blocked = useFriendsStore((s) => s.blocked)

  const pending = useMemo(() => friends.filter((f) => f.status === 'Pending'), [friends])
  const accepted = useMemo(() => friends.filter((f) => f.status === 'Accepted'), [friends])
  const incomingPending = useMemo(() => pending.filter((f) => f.requestedBy !== selfIdentity), [pending, selfIdentity])
  const outgoingPending = useMemo(() => pending.filter((f) => f.requestedBy === selfIdentity), [pending, selfIdentity])

  const otherIdentity = (a: string, b: string) => (a === selfIdentity ? b : a)

  return (
    <section className="pane">
      <header className="pane-header">
        <strong>Friends</strong>
        <div className="tabs">
          <button onClick={() => setTab('all')}>All</button>
          <button onClick={() => setTab('pending')}>Pending</button>
          <button onClick={() => setTab('blocked')}>Blocked</button>
        </div>
      </header>

      <form
        className="inline"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!username.trim()) return
          setError(null)
          const targetIdentity = await resolveIdentityFromUsername(username)
          if (!targetIdentity) {
            setError(`No user found for username "${username}"`)
            return
          }
          await reducers.sendFriendRequest(targetIdentity)
          setUsername('')
        }}
      >
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Add friend by username" />
        <button type="submit">Add</button>
      </form>
      {error ? <p className="error-text">{error}</p> : null}

      {tab === 'all' && (
        <div className="list">
          {accepted.map((f) => {
            const targetIdentity = otherIdentity(f.userA, f.userB)
            return (
              <div className="list-row" key={`${f.userA}:${f.userB}`}>
              <span>
                {targetIdentity.slice(0, 8)}
              </span>
              <button onClick={() => reducers.removeFriend(targetIdentity)}>Remove friend</button>
            </div>
            )
          })}
        </div>
      )}

      {tab === 'pending' && (
        <div className="list">
          <h4>Incoming</h4>
          {incomingPending.map((f) => {
            const requesterIdentity = f.requestedBy
            return (
              <div className="list-row" key={`${f.userA}:${f.userB}:incoming`}>
              <span>
                {requesterIdentity.slice(0, 8)}
              </span>
              <button onClick={() => reducers.acceptFriendRequest(requesterIdentity)}>Accept</button>
              <button onClick={() => reducers.declineFriendRequest(requesterIdentity)}>Decline</button>
            </div>
            )
          })}

          <h4>Outgoing</h4>
          {outgoingPending.map((f) => {
            const requesterIdentity = f.requestedBy
            return (
              <div className="list-row" key={`${f.userA}:${f.userB}:outgoing`}>
                <span>{otherIdentity(f.userA, f.userB).slice(0, 8)}</span>
                <button onClick={() => reducers.declineFriendRequest(requesterIdentity)}>Cancel</button>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'blocked' && (
        <div className="list">
          {blocked.map((b) => (
            <div className="list-row" key={`${b.blocker}:${b.blocked}`}>
              <span>{b.blocked.slice(0, 8)}</span>
              <button onClick={() => reducers.unblockUser(b.blocked)}>Unblock</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
