import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function EditServerModal({ serverId, currentName, onClose }: { serverId: number; currentName: string; onClose: () => void }) {
  const [name, setName] = useState(currentName)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          await reducers.renameServer(serverId, name.trim())
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not rename server.'
          setError(message)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit Server</DialogTitle>
        <DialogDescription>Rename this server or permanently delete it.</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="edit-server-name">Server name</Label>
        <Input id="edit-server-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
        <Button
          variant="destructive"
          type="button"
          onClick={async () => {
            setError(null)
            try {
              await reducers.deleteServer(serverId)
              onClose()
            } catch (e) {
              const message = e instanceof Error ? e.message : 'Could not delete server.'
              setError(message)
            }
          }}
        >
          Delete Server
        </Button>
      </div>
    </form>
  )
}
