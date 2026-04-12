import {
  ClockIcon,
  CrownIcon,
  HammerIcon,
  ListXIcon,
  MoreHorizontalIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  TimerOffIcon,
  UserMinusIcon,
} from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import type { ServerMemberWithUser } from '../../stores/membersStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMemberSince, hasActiveTimeout, memberLabel, memberUsername, roleBadgeClassName } from './helpers'
import type { MemberActionModal } from './types'

type MembersTabProps = {
  role: 'Owner' | 'Moderator'
  serverId: number
  sortedMembers: ServerMemberWithUser[]
  selfIdentity: string | null
  canModerateMembers: boolean
  isOwner: boolean
  onSetMemberAction: (action: MemberActionModal) => void
}

export function MembersTab({
  role,
  serverId,
  sortedMembers,
  selfIdentity,
  canModerateMembers,
  isOwner,
  onSetMemberAction,
}: MembersTabProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col border-border/70 bg-background/40">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>Roles, join dates, and moderation controls.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{sortedMembers.length}</Badge>
          {canModerateMembers ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onSetMemberAction({ kind: 'banList' })}>
              <ListXIcon className="size-4" />
              Ban List
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pt-0">
        <ScrollArea className="h-full pr-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Member Since</TableHead>
                <TableHead className="w-[80px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMembers.map((member) => {
                const normalizedSelf = selfIdentity?.toLowerCase() ?? null
                const isSelf = normalizedSelf !== null && normalizedSelf === member.userIdentity.toLowerCase()
                const timedOut = hasActiveTimeout(member)
                const canActOnTarget =
                  canModerateMembers &&
                  !isSelf &&
                  (member.role === 'Member' || role === 'Owner')

                return (
                  <TableRow key={`${member.serverId}:${member.userIdentity}`}>
                    <TableCell className="max-w-[260px]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">{memberLabel(member)}</p>
                          {timedOut ? <Badge variant="outline">Timed out</Badge> : null}
                          {isSelf ? <Badge variant="secondary">You</Badge> : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">@{memberUsername(member)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={roleBadgeClassName(member.role)}>
                        {member.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatMemberSince(member.joinedAt)}</TableCell>
                    <TableCell className="text-right">
                      {canActOnTarget ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-md border border-border/70 bg-background/70 hover:bg-muted">
                            <MoreHorizontalIcon className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {timedOut ? (
                              <DropdownMenuItem onClick={() => void reducers.removeTimeout(serverId, member.userIdentity)}>
                                <TimerOffIcon className="size-4" />
                                Remove timeout
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => onSetMemberAction({ kind: 'timeout', member })}>
                                <ClockIcon className="size-4" />
                                Timeout
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => onSetMemberAction({ kind: 'kick', member })}
                              className="text-destructive focus:text-destructive"
                            >
                              <UserMinusIcon className="size-4" />
                              Kick
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onSetMemberAction({ kind: 'ban', member })}
                              className="text-destructive focus:text-destructive"
                            >
                              <HammerIcon className="size-4" />
                              Ban
                            </DropdownMenuItem>

                            {isOwner && member.role !== 'Owner' ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger>
                                    <ShieldCheckIcon className="size-4" />
                                    Set Role
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    <DropdownMenuItem
                                      disabled={member.role === 'Member'}
                                      onClick={() => onSetMemberAction({ kind: 'setRole', member, newRole: 'Member' })}
                                    >
                                      <ShieldOffIcon className="size-4" />
                                      Member
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={member.role === 'Moderator'}
                                      onClick={() => onSetMemberAction({ kind: 'setRole', member, newRole: 'Moderator' })}
                                    >
                                      <ShieldCheckIcon className="size-4" />
                                      Moderator
                                    </DropdownMenuItem>
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                <DropdownMenuItem onClick={() => onSetMemberAction({ kind: 'transferOwnership', member })}>
                                  <CrownIcon className="size-4" />
                                  Transfer ownership
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
