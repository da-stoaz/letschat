import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function CreateServerModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          await reducers.createServer(name.trim())
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not create server.'
          setError(message)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Create Server</DialogTitle>
        <DialogDescription>Set a name for your new server space.</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="server-name">Server name</Label>
        <Input
          id="server-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={100}
          required
          placeholder="e.g. Product Guild"
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Create</Button>
      </div>
    </form>
  )
}
