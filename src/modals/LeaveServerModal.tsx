import { useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { reducers } from '../lib/spacetimedb'
import { useServersStore } from '../stores/serversStore'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface LeaveServerModalProps {
  serverId: number
  serverName: string
  onClose: () => void
  onLeft?: () => void
}

export function LeaveServerModal({ serverId, serverName, onClose, onLeft }: LeaveServerModalProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLeave = async () => {
    setLoading(true)
    setError(null)
    try {
      await reducers.leaveServer(serverId)
      // Drop the space locally right away. The subscription update that removes
      // it is coalesced and lands a beat later; without this, navigating to
      // `/app` would pick the space we just left as the "first" one and land
      // on an empty, memberless view of it.
      useServersStore.setState((state) => ({
        servers: state.servers.filter((server) => server.id !== serverId),
        activeServerId: state.activeServerId === serverId ? null : state.activeServerId,
      }))
      onClose()
      onLeft?.()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not leave space.'
      setError(message)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-destructive">
          <LogOutIcon className="size-4" />
          Leave Space
        </DialogTitle>
        <DialogDescription>
          Leave <strong>{serverName}</strong>? It disappears from your sidebar and you can only return with a valid
          invite.
        </DialogDescription>
      </DialogHeader>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" disabled={loading} onClick={() => void handleLeave()}>
          {loading ? 'Leaving…' : 'Leave Space'}
        </Button>
      </div>
    </div>
  )
}
