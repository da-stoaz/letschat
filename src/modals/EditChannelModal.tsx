import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

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
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        await reducers.updateChannel(channelId, { name, moderatorOnly })
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit Channel</DialogTitle>
        <DialogDescription>Update channel details or delete it.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="edit-channel-name">Channel name</Label>
        <Input
          id="edit-channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          maxLength={100}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
        <Label htmlFor="edit-channel-mod-only">Moderator only</Label>
        <Switch id="edit-channel-mod-only" checked={moderatorOnly} onCheckedChange={setModeratorOnly} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="submit">Save</Button>
        <Button
          variant="destructive"
          type="button"
          onClick={async () => {
            await reducers.deleteChannel(channelId)
            onClose()
          }}
        >
          Delete Channel
        </Button>
      </div>
    </form>
  )
}
