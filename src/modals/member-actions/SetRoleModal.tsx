import { useState } from 'react'
import { ShieldCheckIcon, CheckIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ServerMemberWithUser } from '../../stores/membersStore'
import { memberUsername } from './shared'

interface SetRoleModalProps {
  serverId: number
  member: ServerMemberWithUser
  newRole: 'Member' | 'Moderator'
  onClose: () => void
}

export function SetRoleModal({ serverId, member, newRole, onClose }: SetRoleModalProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSet = async () => {
    setLoading(true)
    setError(null)
    try {
      await reducers.setMemberRole(serverId, member.userIdentity, newRole)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set role.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-primary" />
          Set Role: {newRole}
        </DialogTitle>
        <DialogDescription>
          Change <strong>@{memberUsername(member)}</strong>'s role to <strong>{newRole}</strong>.
          {newRole === 'Moderator' && ' Moderators can kick, ban, and timeout members.'}
          {newRole === 'Member' && ' The user will lose moderator privileges.'}
        </DialogDescription>
      </DialogHeader>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={loading} onClick={handleSet}>
          <CheckIcon className="size-4" />
          {loading ? 'Updating…' : `Make ${newRole}`}
        </Button>
      </div>
    </div>
  )
}

