import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'

export function EditChannelModal({
  channelId,
  currentName,
  currentModeratorOnly,
  onClose,
}: {
  channelId: number
  currentName: string
  currentModeratorOnly: boolean
  onClose: () => void
}) {
  const [name, setName] = useState(currentName)
  const [moderatorOnly, setModeratorOnly] = useState(currentModeratorOnly)

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault()
        await reducers.updateChannel(channelId, { name, moderatorOnly })
        onClose()
      }}
    >
      <h3>Edit Channel</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} required minLength={1} maxLength={100} />
      <label>
        <input type="checkbox" checked={moderatorOnly} onChange={(e) => setModeratorOnly(e.target.checked)} />
        Moderator only
      </label>
      <button type="submit">Save</button>
      <button
        type="button"
        className="danger"
        onClick={async () => {
          await reducers.deleteChannel(channelId)
          onClose()
        }}
      >
        Delete Channel
      </button>
    </form>
  )
}
