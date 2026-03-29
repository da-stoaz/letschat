import { useState } from 'react'
import { HammerIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { memberLabel, memberUsername, type MemberActionModalProps } from './shared'

export function BanMemberModal({ serverId, member, onClose }: MemberActionModalProps) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleBan = async () => {
    setLoading(true)
    setError(null)
    try {
      await reducers.banMember(serverId, member.userIdentity, reason.trim() || undefined)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to ban member.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <HammerIcon className="size-4 text-destructive" />
          Ban {memberLabel(member)}
        </DialogTitle>
        <DialogDescription>
          <strong>@{memberUsername(member)}</strong> will be permanently banned and cannot rejoin via any invite.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="ban-reason">Reason (optional)</Label>
        <Input
          id="ban-reason"
          placeholder="Enter a reason…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" disabled={loading} onClick={handleBan}>
          {loading ? 'Banning…' : 'Ban Member'}
        </Button>
      </div>
    </div>
  )
}

