import { useEffect, useState } from 'react'
import { HammerIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { useUsersStore } from '../../stores/usersStore'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

interface BanListModalProps {
  serverId: number
  onClose: () => void
}

interface BanRow {
  identity: string
  reason: string | null
  bannedAt: string
}

export function BanListModal({ serverId, onClose }: BanListModalProps) {
  const [error, setError] = useState<string | null>(null)
  const [unbanningId, setUnbanningId] = useState<string | null>(null)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
  const [bans, setBans] = useState<BanRow[]>([])

  useEffect(() => {
    try {
      const conn = (window as unknown as Record<string, unknown>).__stdb_conn as {
        db: {
          ban: {
            iter: () => Iterable<{
              serverId: unknown
              userIdentity: { toHexString?: () => string; toString: () => string }
              reason: string | null
              bannedAt: { toDate?: () => Date }
            }>
          }
        }
      } | undefined

      if (conn?.db?.ban) {
        const banRows = Array.from(conn.db.ban.iter())
          .filter((row) => Number(row.serverId) === serverId)
          .map((row) => ({
            identity: typeof row.userIdentity.toHexString === 'function'
              ? row.userIdentity.toHexString()
              : row.userIdentity.toString(),
            reason: row.reason,
            bannedAt: row.bannedAt.toDate?.().toISOString() ?? new Date().toISOString(),
          }))
        setBans(banRows)
      }
    } catch {
      // Ignore if ban rows are unavailable
    }
  }, [serverId])

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
                    <p className="truncate text-sm">{label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
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

