import { useState } from 'react'
import { CrownIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { memberUsername, type MemberActionModalProps } from './shared'

export function TransferOwnershipModal({ serverId, member, onClose }: MemberActionModalProps) {
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const username = memberUsername(member)

  const handleTransfer = async () => {
    setLoading(true)
    setError(null)
    try {
      await reducers.transferOwnership(serverId, member.userIdentity)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to transfer ownership.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CrownIcon className="size-4 text-yellow-500" />
          Transfer Ownership
        </DialogTitle>
        <DialogDescription>
          You will become a Moderator. <strong>@{username}</strong> will become the new Owner.
          This action cannot be undone without cooperation from the new owner.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label>Type <strong>{username}</strong> to confirm</Label>
        <Input
          placeholder={username}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          autoComplete="off"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          variant="destructive"
          disabled={loading || confirm !== username}
          onClick={handleTransfer}
        >
          {loading ? 'Transferring…' : 'Transfer Ownership'}
        </Button>
      </div>
    </div>
  )
}

