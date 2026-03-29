import { useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import { useMembersStore } from '../stores/membersStore'
import { useUsersStore } from '../stores/usersStore'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  UserMinusIcon,
  HammerIcon,
  ClockIcon,
  ShieldCheckIcon,
  CrownIcon,
  CheckIcon,
  AlertTriangleIcon,
} from 'lucide-react'
import type { ServerMemberWithUser } from '../stores/membersStore'

function memberLabel(member: ServerMemberWithUser): string {
  return member.user?.displayName ?? member.user?.username ?? member.userIdentity.slice(0, 12)
}

function memberUsername(member: ServerMemberWithUser): string {
  return member.user?.username ?? member.userIdentity.slice(0, 12)
}

// ─── Kick ────────────────────────────────────────────────────────────────────

export function KickMemberModal({
  serverId,
  member,
  onClose,
}: {
  serverId: number
  member: ServerMemberWithUser
  onClose: () => void
}) {
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

// ─── Ban ─────────────────────────────────────────────────────────────────────

export function BanMemberModal({
  serverId,
  member,
  onClose,
}: {
  serverId: number
  member: ServerMemberWithUser
  onClose: () => void
}) {
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

// ─── Timeout ─────────────────────────────────────────────────────────────────

const TIMEOUT_OPTIONS = [
  { label: '60 seconds', value: 60 },
  { label: '5 minutes', value: 5 * 60 },
  { label: '10 minutes', value: 10 * 60 },
  { label: '1 hour', value: 60 * 60 },
  { label: '1 day', value: 24 * 60 * 60 },
  { label: '1 week', value: 7 * 24 * 60 * 60 },
  { label: '4 weeks', value: 28 * 24 * 60 * 60 },
]

export function TimeoutMemberModal({
  serverId,
  member,
  onClose,
}: {
  serverId: number
  member: ServerMemberWithUser
  onClose: () => void
}) {
  const [durationSeconds, setDurationSeconds] = useState(10 * 60)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleTimeout = async () => {
    setLoading(true)
    setError(null)
    try {
      await reducers.timeoutMember(serverId, member.userIdentity, durationSeconds)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to timeout member.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ClockIcon className="size-4 text-yellow-500" />
          Timeout {memberLabel(member)}
        </DialogTitle>
        <DialogDescription>
          <strong>@{memberUsername(member)}</strong> will be prevented from sending messages for the selected duration.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label>Duration</Label>
        <Select
          value={String(durationSeconds)}
          onValueChange={(v) => setDurationSeconds(Number(v))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEOUT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={loading} onClick={handleTimeout}>
          {loading ? 'Applying…' : 'Apply Timeout'}
        </Button>
      </div>
    </div>
  )
}

// ─── Set Role ─────────────────────────────────────────────────────────────────

export function SetRoleModal({
  serverId,
  member,
  newRole,
  onClose,
}: {
  serverId: number
  member: ServerMemberWithUser
  newRole: 'Member' | 'Moderator'
  onClose: () => void
}) {
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

// ─── Transfer Ownership ───────────────────────────────────────────────────────

export function TransferOwnershipModal({
  serverId,
  member,
  onClose,
}: {
  serverId: number
  member: ServerMemberWithUser
  onClose: () => void
}) {
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

// ─── Ban List ─────────────────────────────────────────────────────────────────

export function BanListModal({
  serverId,
  onClose,
}: {
  serverId: number
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [unbanningId, setUnbanningId] = useState<string | null>(null)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)

  // We need to get bans from the store. Since the ban table is public but we don't
  // have a dedicated bansStore yet, we access it through the spacetimedb connection.
  // For now we use the members store context and read from the raw DB.
  // The bans are available via the SpacetimeDB connection's db.ban table.
  const [bans, setBans] = useState<Array<{ identity: string; reason: string | null; bannedAt: string }>>([])

  // Load bans from global spacetime connection on mount
  useState(() => {
    try {
      // Access SpacetimeDB connection dynamically
      const conn = (window as unknown as Record<string, unknown>).__stdb_conn as {
        db: { ban: { iter: () => Iterable<{ serverId: unknown; userIdentity: { toHexString?: () => string; toString: () => string }; reason: string | null; bannedAt: { toDate?: () => Date } }> } }
      } | undefined
      if (conn?.db?.ban) {
        const banRows = Array.from(conn.db.ban.iter())
          .filter((b) => Number(b.serverId) === serverId)
          .map((b) => ({
            identity: typeof b.userIdentity.toHexString === 'function'
              ? b.userIdentity.toHexString()
              : b.userIdentity.toString(),
            reason: b.reason,
            bannedAt: b.bannedAt.toDate?.().toISOString() ?? new Date().toISOString(),
          }))
        setBans(banRows)
      }
    } catch {
      // Silently fail if we can't access bans
    }
  })

  const handleUnban = async (identity: string) => {
    setUnbanningId(identity)
    setError(null)
    try {
      await reducers.unbanMember(serverId, identity)
      setBans((prev) => prev.filter((b) => b.identity !== identity))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unban.')
    } finally {
      setUnbanningId(null)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <HammerIcon className="size-4" />
          Banned Members
        </DialogTitle>
        <DialogDescription>
          Members banned from this server. Unbanning allows them to rejoin with a valid invite.
        </DialogDescription>
      </DialogHeader>

      {bans.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          No banned members.
        </div>
      ) : (
        <ScrollArea className="max-h-72">
          <div className="space-y-2 pr-1">
            {bans.map((ban) => {
              const user = Object.values(usersByIdentity).find(
                (u) => u.identity.toLowerCase() === ban.identity.toLowerCase(),
              )
              const label = user?.displayName ?? user?.username ?? ban.identity.slice(0, 14)
              const username = user?.username ?? ban.identity.slice(0, 12)
              return (
                <div key={ban.identity} className="flex items-center gap-2 rounded-lg border border-border/60 p-2">
                  <Avatar size="sm" className="rounded-lg">
                    {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={label} /> : null}
                    <AvatarFallback className="rounded-lg bg-destructive/10 text-[10px]">
                      {label.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      @{username}
                      {ban.reason ? ` · ${ban.reason}` : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={unbanningId === ban.identity}
                    onClick={() => handleUnban(ban.identity)}
                  >
                    {unbanningId === ban.identity ? 'Unbanning…' : 'Unban'}
                  </Button>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}
