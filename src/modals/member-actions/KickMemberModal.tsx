import { useState } from 'react'
import { UserMinusIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { memberLabel, memberUsername, type MemberActionModalProps } from './shared'

export function KickMemberModal({ serverId, member, onClose }: MemberActionModalProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleKick = async () => {
    setLoading(true)
    setError(null)
    try {
      await reducers.kickMember(serverId, member.userIdentity)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to kick member.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <UserMinusIcon className="size-4 text-destructive" />
          Kick {memberLabel(member)}
        </DialogTitle>
        <DialogDescription>
          This will remove <strong>@{memberUsername(member)}</strong> from the server. They can rejoin with a new invite.
        </DialogDescription>
      </DialogHeader>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" disabled={loading} onClick={handleKick}>
          {loading ? 'Kicking…' : 'Kick Member'}
        </Button>
      </div>
    </div>
  )
}

