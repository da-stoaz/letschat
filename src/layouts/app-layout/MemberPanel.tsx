import { useMemo } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { PresenceDot } from '@/components/user/PresenceDot'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { userInitials } from './helpers'
import {
  ShieldOffIcon,
  ShieldCheckIcon,
  UserMinusIcon,
  HammerIcon,
  ClockIcon,
  CrownIcon,
  MoreHorizontalIcon,
  TimerOffIcon,
} from 'lucide-react'
import type { ServerMemberWithUser } from '../../stores/membersStore'
import type { Role } from '../../types/domain'

interface MemberPanelProps {
  members: ServerMemberWithUser[]
  selfIdentity: string | null
  selfRole: Role | null
  serverId: number | null
  onKick: (member: ServerMemberWithUser) => void
  onBan: (member: ServerMemberWithUser) => void
  onTimeout: (member: ServerMemberWithUser) => void
  onRemoveTimeout: (member: ServerMemberWithUser) => void
  onSetRole: (member: ServerMemberWithUser, newRole: 'Member' | 'Moderator') => void
  onTransferOwnership: (member: ServerMemberWithUser) => void
}

const ROLE_ORDER = ['Owner', 'Moderator', 'Member'] as const

function isTimedOut(member: ServerMemberWithUser): boolean {
  if (!member.timeoutUntil) return false
  return new Date(member.timeoutUntil).getTime() > Date.now()
}

function MemberRow({
  member,
  selfIdentity,
  selfRole,
  onKick,
  onBan,
  onTimeout,
  onRemoveTimeout,
  onSetRole,
  onTransferOwnership,
}: {
  member: ServerMemberWithUser
  selfIdentity: string | null
  selfRole: Role | null
  onKick: (m: ServerMemberWithUser) => void
  onBan: (m: ServerMemberWithUser) => void
  onTimeout: (m: ServerMemberWithUser) => void
  onRemoveTimeout: (m: ServerMemberWithUser) => void
  onSetRole: (m: ServerMemberWithUser, role: 'Member' | 'Moderator') => void
  onTransferOwnership: (m: ServerMemberWithUser) => void
}) {
  const presentation = useUserPresentation(member.userIdentity)
  const displayName = member.user?.displayName || member.user?.username || presentation.displayName
  const username = member.user?.username || presentation.username
  const avatarUrl = member.user?.avatarUrl ?? presentation.avatarUrl
  const isSelf = selfIdentity?.toLowerCase() === member.userIdentity.toLowerCase()
  const timedOut = isTimedOut(member)

  const canManage = selfRole === 'Owner' || selfRole === 'Moderator'
  const canActOnTarget =
    canManage &&
    !isSelf &&
    (member.role === 'Member' || selfRole === 'Owner')
  const showMenu = canActOnTarget

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/40 group ${timedOut ? 'opacity-60' : ''}`}
    >
      <div className="relative">
        <Avatar size="sm" className="rounded-lg">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
          <AvatarFallback className="rounded-lg bg-primary/10 text-[10px]">{userInitials(displayName)}</AvatarFallback>
        </Avatar>
        {timedOut && (
          <ClockIcon className="absolute -bottom-0.5 -right-0.5 size-3 text-yellow-500 bg-card rounded-full" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm">{displayName}</p>
          <PresenceDot status={presentation.status} className="size-1.5" />
        </div>
        <p className="truncate text-[11px] text-muted-foreground">@{username}</p>
      </div>
      {isSelf ? (
        <Badge variant="outline" className="text-[10px]">You</Badge>
      ) : showMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="size-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontalIcon className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <p className="px-1.5 py-1 text-xs font-medium text-muted-foreground">{displayName}</p>
            <DropdownMenuSeparator />

            {/* Timeout actions */}
            {timedOut ? (
              <DropdownMenuItem onClick={() => onRemoveTimeout(member)} className="text-xs">
                <TimerOffIcon className="size-3.5" />
                Remove timeout
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onTimeout(member)} className="text-xs">
                <ClockIcon className="size-3.5" />
                Timeout
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onClick={() => onKick(member)}
              className="text-xs text-destructive focus:text-destructive"
            >
              <UserMinusIcon className="size-3.5" />
              Kick
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onBan(member)}
              className="text-xs text-destructive focus:text-destructive"
            >
              <HammerIcon className="size-3.5" />
              Ban
            </DropdownMenuItem>

            {/* Role management (Owner only) */}
            {selfRole === 'Owner' && member.role !== 'Owner' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="text-xs">
                    <ShieldCheckIcon className="size-3.5" />
                    Set Role
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      className="text-xs"
                      disabled={member.role === 'Member'}
                      onClick={() => onSetRole(member, 'Member')}
                    >
                      <ShieldOffIcon className="size-3.5" />
                      Member
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-xs"
                      disabled={member.role === 'Moderator'}
                      onClick={() => onSetRole(member, 'Moderator')}
                    >
                      <ShieldCheckIcon className="size-3.5" />
                      Moderator
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  onClick={() => onTransferOwnership(member)}
                  className="text-xs"
                >
                  <CrownIcon className="size-3.5" />
                  Transfer Ownership
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

export function MemberPanel({
  members,
  selfIdentity,
  selfRole,
  onKick,
  onBan,
  onTimeout,
  onRemoveTimeout,
  onSetRole,
  onTransferOwnership,
}: MemberPanelProps) {
  const groupedMembers = useMemo(() => {
    const groups: Record<(typeof ROLE_ORDER)[number], ServerMemberWithUser[]> = {
      Owner: [],
      Moderator: [],
      Member: [],
    }

    for (const member of members) {
      groups[member.role].push(member)
    }

    for (const role of ROLE_ORDER) {
      groups[role].sort((left, right) => {
        const leftName = left.user?.displayName || left.user?.username || left.userIdentity
        const rightName = right.user?.displayName || right.user?.username || right.userIdentity
        return leftName.localeCompare(rightName)
      })
    }

    return groups
  }, [members])

  return (
    <aside className="h-full rounded-xl border border-border/70 bg-card/70 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Members</h3>
        <Badge variant="secondary">{members.length}</Badge>
      </div>

      <ScrollArea className="h-[calc(100%-2rem)] pr-1">
        <div className="space-y-4">
          {ROLE_ORDER.map((role) => {
            const roleMembers = groupedMembers[role]
            if (roleMembers.length === 0) return null
            return (
              <section key={role} className="space-y-1.5">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{role}s</p>
                {roleMembers.map((member) => (
                  <MemberRow
                    key={`${member.serverId}:${member.userIdentity}`}
                    member={member}
                    selfIdentity={selfIdentity}
                    selfRole={selfRole}
                    onKick={onKick}
                    onBan={onBan}
                    onTimeout={onTimeout}
                    onRemoveTimeout={onRemoveTimeout}
                    onSetRole={onSetRole}
                    onTransferOwnership={onTransferOwnership}
                  />
                ))}
              </section>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}
