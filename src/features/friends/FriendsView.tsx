import { useMemo, useState } from 'react'
import { reducers } from '../../lib/spacetimedb'
import { useFriendsStore } from '../../stores/friendsStore'

type Tab = 'all' | 'pending' | 'blocked'

export function FriendsView() {
  const [tab, setTab] = useState<Tab>('all')
  const [username, setUsername] = useState('')
  const friends = useFriendsStore((s) => s.friends)
  const blocked = useFriendsStore((s) => s.blocked)

  const pending = useMemo(() => friends.filter((f) => f.status === 'Pending'), [friends])
  const accepted = useMemo(() => friends.filter((f) => f.status === 'Accepted'), [friends])

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
          await reducers.sendFriendRequest(username.trim())
          setUsername('')
        }}
      >
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Add friend by identity" />
        <button type="submit">Add</button>
      </form>

      {tab === 'all' && (
        <div className="list">
          {accepted.map((f, idx) => (
            <div className="list-row" key={idx}>
              <span>
                {f.userA.slice(0, 8)} / {f.userB.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === 'pending' && (
        <div className="list">
          {pending.map((f, idx) => (
            <div className="list-row" key={idx}>
              <span>
                Request: {f.userA.slice(0, 8)} / {f.userB.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === 'blocked' && (
        <div className="list">
          {blocked.map((b, idx) => (
            <div className="list-row" key={idx}>
              <span>{b.blocked.slice(0, 8)}</span>
              <button onClick={() => reducers.unblockUser(b.blocked)}>Unblock</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
