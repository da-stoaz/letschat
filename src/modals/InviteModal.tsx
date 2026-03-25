import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function InviteModal({ serverId, onClose }: { serverId: number; onClose: () => void }) {
  const [expiresInSeconds, setExpiresInSeconds] = useState<number | ''>('')
  const [maxUses, setMaxUses] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          await reducers.createInvite(
            serverId,
            expiresInSeconds === '' ? undefined : expiresInSeconds,
            maxUses === '' ? undefined : maxUses,
          )
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not create invite.'
          setError(message)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Create Invite</DialogTitle>
        <DialogDescription>Create an invite with optional expiry and usage limit.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="invite-expiration">Expiration (seconds)</Label>
        <Input
          id="invite-expiration"
          type="number"
          value={expiresInSeconds}
          onChange={(e) => setExpiresInSeconds(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-max-uses">Max uses</Label>
        <Input
          id="invite-max-uses"
          type="number"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Create Invite</Button>
      </div>
    </form>
  )
}
