import { useState } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { reducers } from '../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface DeleteServerModalProps {
  serverId: number
  serverName: string
  onClose: () => void
  onDeleted?: () => void
}

export function DeleteServerModal({ serverId, serverName, onClose, onDeleted }: DeleteServerModalProps) {
  const [confirmName, setConfirmName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    setLoading(true)
    setError(null)
    try {
      await reducers.deleteServer(serverId)
      onClose()
      onDeleted?.()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not delete server.'
      setError(message)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangleIcon className="size-4" />
          Delete Server
        </DialogTitle>
        <DialogDescription>
          This permanently deletes the server, all channels, and all messages.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        This action cannot be undone.
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="delete-server-confirm">
          Type <strong>{serverName}</strong> to confirm
        </Label>
        <Input
          id="delete-server-confirm"
          value={confirmName}
          onChange={(event) => setConfirmName(event.target.value)}
          placeholder={serverName}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          autoComplete="off"
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={loading || confirmName !== serverName}
          onClick={() => void handleDelete()}
        >
          {loading ? 'Deleting...' : 'Delete Server'}
        </Button>
      </div>
    </div>
  )
}
