import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import type { ChannelKind } from '../types/domain'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export function CreateChannelModal({ serverId, onClose }: { serverId: number; onClose: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ChannelKind>('Text')
  const [moderatorOnly, setModeratorOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          await reducers.createChannel(serverId, name.trim(), kind, moderatorOnly)
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not create channel.'
          setError(message)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Create Channel</DialogTitle>
        <DialogDescription>Choose a channel type and permissions.</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="channel-name">Channel name</Label>
        <Input id="channel-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={1} maxLength={100} />
      </div>

      <div className="space-y-2">
        <Label>Channel type</Label>
        <Select value={kind} onValueChange={(value) => setKind(value as ChannelKind)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select channel type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Text">Text</SelectItem>
            <SelectItem value="Voice">Voice</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
        <div>
          <p className="text-sm font-medium">Moderator only</p>
          <p className="text-xs text-muted-foreground">Restrict posting/joining to moderators and owners.</p>
        </div>
        <Switch checked={moderatorOnly} onCheckedChange={setModeratorOnly} />
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
