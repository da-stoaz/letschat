import { useMemo } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PresenceDot } from '@/components/user/PresenceDot'
import { useUserPresentation } from '../../hooks/useUserPresentation'
import { userInitials } from './helpers'
import type { ServerMemberWithUser } from '../../stores/membersStore'

interface MemberPanelProps {
  members: ServerMemberWithUser[]
  selfIdentity: string | null
}

const ROLE_ORDER = ['Owner', 'Moderator', 'Member'] as const

function MemberRow({ member, selfIdentity }: { member: ServerMemberWithUser; selfIdentity: string | null }) {
  const presentation = useUserPresentation(member.userIdentity)
  const displayName = member.user?.displayName || member.user?.username || presentation.displayName
  const username = member.user?.username || presentation.username
  const avatarUrl = member.user?.avatarUrl ?? presentation.avatarUrl
  const isSelf = selfIdentity === member.userIdentity

  return (
    <div key={`${member.serverId}:${member.userIdentity}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/40">
      <Avatar size="sm" className="rounded-lg">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
        <AvatarFallback className="rounded-lg bg-primary/10 text-[10px]">{userInitials(displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm">{displayName}</p>
          <PresenceDot status={presentation.status} className="size-1.5" />
        </div>
        <p className="truncate text-[11px] text-muted-foreground">@{username}</p>
      </div>
      {isSelf ? <Badge variant="outline">You</Badge> : null}
    </div>
  )
}

export function MemberPanel({ members, selfIdentity }: MemberPanelProps) {
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
                {roleMembers.map((member) => {
                  return <MemberRow key={`${member.serverId}:${member.userIdentity}`} member={member} selfIdentity={selfIdentity} />
                })}
              </section>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}
