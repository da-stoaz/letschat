import { useMemo, useState, type ReactNode } from 'react'
import {
  type Column,
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
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
import { cn } from '../../lib/utils'
import type { ServerMemberWithUser } from '../../stores/membersStore'
import type { Role } from '../../types/domain'
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
import { formatMemberSince, hasActiveTimeout, matchesSearch, memberLabel, memberUsername, roleBadgeClassName } from './helpers'
import { ListSearchInput } from './ListSearchInput'
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

const ROLE_PRIORITY: Record<Role, number> = { Owner: 0, Moderator: 1, Member: 2 }

/** A column header that toggles this column's sort, with a direction indicator. */
function SortHeader({
  column,
  children,
  align = 'left',
}: {
  column: Column<ServerMemberWithUser, unknown>
  children: ReactNode
  align?: 'left' | 'right'
}) {
  const sorted = column.getIsSorted()
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === 'asc')}
      className={cn(
        '-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:text-foreground',
        sorted ? 'text-foreground' : 'text-muted-foreground',
        align === 'right' && 'flex-row-reverse',
      )}
    >
      {children}
      {sorted === 'asc' ? (
        <ArrowUpIcon className="size-3.5" />
      ) : sorted === 'desc' ? (
        <ArrowDownIcon className="size-3.5" />
      ) : (
        <ChevronsUpDownIcon className="size-3.5 opacity-40" />
      )}
    </button>
  )
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
  const [sorting, setSorting] = useState<SortingState>([{ id: 'role', desc: false }])
  const [search, setSearch] = useState('')

  const normalizedSelf = selfIdentity?.toLowerCase() ?? null

  const columns = useMemo<ColumnDef<ServerMemberWithUser>[]>(
    () => [
      {
        id: 'user',
        accessorFn: (m) => memberLabel(m),
        header: ({ column }) => <SortHeader column={column}>User</SortHeader>,
        cell: ({ row }) => {
          const member = row.original
          const isSelf = normalizedSelf !== null && normalizedSelf === member.userIdentity.toLowerCase()
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{memberLabel(member)}</p>
                {hasActiveTimeout(member) ? <Badge variant="outline">Timed out</Badge> : null}
                {isSelf ? <Badge variant="secondary">You</Badge> : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">@{memberUsername(member)}</p>
            </div>
          )
        },
      },
      {
        id: 'role',
        accessorFn: (m) => ROLE_PRIORITY[m.role],
        header: ({ column }) => <SortHeader column={column}>Role</SortHeader>,
        cell: ({ row }) => (
          <Badge variant="outline" className={roleBadgeClassName(row.original.role)}>
            {row.original.role}
          </Badge>
        ),
      },
      {
        id: 'joinedAt',
        accessorFn: (m) => m.joinedAt,
        header: ({ column }) => <SortHeader column={column}>Member since</SortHeader>,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatMemberSince(row.original.joinedAt)}</span>
        ),
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <span className="text-muted-foreground">Actions</span>,
        cell: ({ row }) => {
          const member = row.original
          const isSelf = normalizedSelf !== null && normalizedSelf === member.userIdentity.toLowerCase()
          const timedOut = hasActiveTimeout(member)
          const canActOnTarget = canModerateMembers && !isSelf && (member.role === 'Member' || role === 'Owner')
          if (!canActOnTarget) return <span className="text-xs text-muted-foreground">—</span>

          return (
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
          )
        },
      },
    ],
    [role, serverId, normalizedSelf, canModerateMembers, isOwner, onSetMemberAction],
  )

  // TanStack Table returns non-memoizable functions; React Compiler skips
  // optimizing this component, which is the expected/supported behavior.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: sortedMembers,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _columnId, value) =>
      matchesSearch(value, memberLabel(row.original), memberUsername(row.original)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const rows = table.getRowModel().rows

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
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-0">
        <ListSearchInput value={search} onChange={setSearch} placeholder="Search by name or @username…" />

        <ScrollArea className="h-full pr-2">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={header.column.id === 'actions' ? 'w-[80px] text-right' : undefined}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-muted-foreground">
                    {search.trim().length > 0 ? 'No members match your search.' : 'No members yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          cell.column.id === 'user' && 'max-w-[260px]',
                          cell.column.id === 'actions' && 'text-right',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
