import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClockIcon,
  CrownIcon,
  ExternalLinkIcon,
  HammerIcon,
  HashIcon,
  ListXIcon,
  LogOutIcon,
  MegaphoneIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Settings2Icon,
  ShieldCheckIcon,
  ShieldOffIcon,
  TimerOffIcon,
  Trash2Icon,
  UserMinusIcon,
  Volume2Icon,
} from 'lucide-react'
import { reducers } from '../lib/spacetimedb'
import { useChannelsStore } from '../stores/channelsStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useMembersStore, type ServerMemberWithUser } from '../stores/membersStore'
import { useServersStore } from '../stores/serversStore'
import { useServerRole } from '../hooks/useServerRole'
import { canManageChannels } from '../lib/permissions'
import { EditServerModal } from '../modals/EditServerModal'
import { DeleteServerModal } from '../modals/DeleteServerModal'
import { CreateChannelModal } from '../modals/CreateChannelModal'
import { EditChannelModal } from '../modals/EditChannelModal'
import {
  BanListModal,
  BanMemberModal,
  KickMemberModal,
  SetRoleModal,
  TimeoutMemberModal,
  TransferOwnershipModal,
} from '../modals/member-actions'
import type { Channel, ServerInvitePolicy } from '../types/domain'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/components/ui/sonner'
import { serverInitials } from '../layouts/app-layout/helpers'

type MemberActionModal =
  | { kind: 'kick'; member: ServerMemberWithUser }
  | { kind: 'ban'; member: ServerMemberWithUser }
  | { kind: 'timeout'; member: ServerMemberWithUser }
  | { kind: 'setRole'; member: ServerMemberWithUser; newRole: 'Member' | 'Moderator' }
  | { kind: 'transferOwnership'; member: ServerMemberWithUser }
  | { kind: 'banList' }

type PendingDeleteAction =
  | { kind: 'channel'; channel: Channel }
  | { kind: 'section'; group: { section: string | null; channels: Channel[] } }

type ChannelGroup = {
  key: string
  section: string | null
  channels: Channel[]
}

type SortableChannelRowProps = {
  channel: Channel
  orderLabel: number
  canMoveUp: boolean
  canMoveDown: boolean
  canManageServerChannels: boolean
  isReordering: boolean
  onMoveChannel: (channelId: number, direction: -1 | 1) => void
  onDeleteChannel: (channel: Channel) => void
  onManageChannel: (channel: Channel) => void
}

function SortableChannelRow({
  channel,
  orderLabel,
  canMoveUp,
  canMoveDown,
  canManageServerChannels,
  isReordering,
  onMoveChannel,
  onDeleteChannel,
  onManageChannel,
}: SortableChannelRowProps) {
  const KindIcon = channel.kind === 'Voice'
    ? Volume2Icon
    : channel.kind === 'Announcement'
      ? MegaphoneIcon
      : HashIcon

  return (
    <TableRow>
      <TableCell>
        <span className="text-xs text-muted-foreground">{orderLabel}</span>
      </TableCell>
      <TableCell className="font-medium">
        <span className="inline-flex items-center gap-2">
          <KindIcon className="size-4 opacity-70" />
          {channel.name}
          <Badge variant="outline" className="text-[10px]">
            {channel.kind}
          </Badge>
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={channel.moderatorOnly ? 'secondary' : 'outline'}>
          {channel.moderatorOnly ? 'Moderators only' : 'Everyone'}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        {canManageServerChannels ? (
          <div className="inline-flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => onMoveChannel(channel.id, -1)}
              disabled={!canMoveUp || isReordering}
              aria-label="Move channel up"
              title="Move up"
            >
              <ArrowUpIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => onMoveChannel(channel.id, 1)}
              disabled={!canMoveDown || isReordering}
              aria-label="Move channel down"
              title="Move down"
            >
              <ArrowDownIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon-sm"
              onClick={() => onDeleteChannel(channel)}
              disabled={isReordering}
              aria-label="Delete channel"
              title="Delete channel"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onManageChannel(channel)}
              disabled={isReordering}
            >
              <Settings2Icon className="size-4" />
              Manage
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Read only</span>
        )}
      </TableCell>
    </TableRow>
  )
}

function memberLabel(member: ServerMemberWithUser): string {
  return member.user?.displayName || member.user?.username || member.userIdentity.slice(0, 12)
}

function memberUsername(member: ServerMemberWithUser): string {
  return member.user?.username || member.userIdentity.slice(0, 12)
}

function formatMemberSince(joinedAt: string): string {
  const date = new Date(joinedAt)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function hasActiveTimeout(member: ServerMemberWithUser): boolean {
  if (!member.timeoutUntil) return false
  return Date.parse(member.timeoutUntil) > Date.now()
}

function invitePolicyLabel(policy: ServerInvitePolicy): string {
  return policy === 'Everyone' ? 'Everyone (all members)' : 'Owner + Moderators'
}

function sectionLabel(section: string | null): string {
  const normalized = section?.trim()
  return normalized && normalized.length > 0 ? normalized : 'general'
}

function sectionKey(section: string | null): string {
  return (section ?? '').trim()
}

function channelGroupKey(channel: Channel): string {
  return sectionKey(channel.section)
}

function roleBadgeClassName(role: ServerMemberWithUser['role']): string {
  if (role === 'Owner') return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
  if (role === 'Moderator') return 'bg-blue-500/15 text-blue-300 border-blue-500/30'
  return ''
}

export function ServerManagePage() {
  const { serverId } = useParams()
  const navigate = useNavigate()
  const numericServerId = Number(serverId)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const setActiveServerId = useServersStore((s) => s.setActiveServerId)
  const role = useServerRole(Number.isFinite(numericServerId) ? numericServerId : null)
  const server = useServersStore((s) => s.servers.find((entry) => entry.id === numericServerId) ?? null)
  const members = useMembersStore((s) => s.membersByServer[numericServerId] ?? [])
  const channels = useChannelsStore((s) => s.channelsByServer[numericServerId] ?? [])

  const [showEditServer, setShowEditServer] = useState(false)
  const [showDeleteServer, setShowDeleteServer] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [createChannelInitialSection, setCreateChannelInitialSection] = useState<string | null>(null)
  const [createChannelDialogSeed, setCreateChannelDialogSeed] = useState(0)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [reorderingChannelId, setReorderingChannelId] = useState<number | null>(null)
  const [memberAction, setMemberAction] = useState<MemberActionModal | null>(null)
  const [pendingDeleteAction, setPendingDeleteAction] = useState<PendingDeleteAction | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [invitePolicySaving, setInvitePolicySaving] = useState(false)

  const isOwner = role === 'Owner'
  const canModerateMembers = role === 'Owner' || role === 'Moderator'
  const canManageServerChannels = role ? canManageChannels(role) : false

  const sortedMembers = useMemo(() => {
    const rolePriority: Record<ServerMemberWithUser['role'], number> = {
      Owner: 0,
      Moderator: 1,
      Member: 2,
    }

    return [...members].sort((left, right) => {
      const roleDelta = rolePriority[left.role] - rolePriority[right.role]
      if (roleDelta !== 0) return roleDelta
      return memberLabel(left).localeCompare(memberLabel(right), undefined, { sensitivity: 'base' })
    })
  }, [members])

  const sortedChannels = useMemo(
    () =>
      [...channels].sort((left, right) => {
        const sectionDelta = sectionKey(left.section).localeCompare(sectionKey(right.section))
        if (sectionDelta !== 0) return sectionDelta
        const positionDelta = left.position - right.position
        if (positionDelta !== 0) return positionDelta
        return left.id - right.id
      }),
    [channels],
  )

  const channelGroups = useMemo(() => {
    const grouped = new Map<string, ChannelGroup>()
    for (const channel of sortedChannels) {
      const key = channelGroupKey(channel)
      const current = grouped.get(key) ?? { key, section: channel.section, channels: [] }
      current.channels.push(channel)
      grouped.set(key, current)
    }

    const groups = [...grouped.values()]
    groups.sort((left, right) => sectionKey(left.section).localeCompare(sectionKey(right.section)))

    for (const group of groups) {
      group.channels.sort((left, right) => {
        const positionDelta = left.position - right.position
        if (positionDelta !== 0) return positionDelta
        return left.id - right.id
      })
    }

    return groups
  }, [sortedChannels])

  const firstMessageChannelId = useMemo(() => {
    const messageChannel = sortedChannels.find((channel) => channel.kind !== 'Voice')
    return messageChannel?.id ?? sortedChannels[0]?.id ?? null
  }, [sortedChannels])
  const serverHomePath = firstMessageChannelId ? `/app/${numericServerId}/${firstMessageChannelId}` : `/app/${numericServerId}`

  const closeMemberAction = () => setMemberAction(null)

  const updateInvitePolicy = async (nextPolicy: ServerInvitePolicy) => {
    if (!isOwner || !server || nextPolicy === server.invitePolicy) return
    setInvitePolicySaving(true)
    try {
      await reducers.setServerInvitePolicy(server.id, nextPolicy)
      toast.success('Invite permission updated')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update invite permission.'
      toast.error('Failed to update invite permission', { description: message })
    } finally {
      setInvitePolicySaving(false)
    }
  }

  const moveChannel = async (channelId: number, direction: -1 | 1) => {
    if (!canManageServerChannels || reorderingChannelId !== null) return

    setReorderingChannelId(channelId)
    try {
      await reducers.moveChannel(channelId, direction)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not reorder channels.'
      toast.error('Failed to reorder channel', { description: message })
    } finally {
      setReorderingChannelId(null)
    }
  }

  const deleteChannel = (channel: Channel) => {
    if (!canManageServerChannels) return
    setPendingDeleteAction({ kind: 'channel', channel })
  }

  const deleteChannelGroup = (group: ChannelGroup) => {
    if (!canManageServerChannels || !server) return
    setPendingDeleteAction({ kind: 'section', group })
  }

  const openCreateChannelDialog = (section: string | null) => {
    setCreateChannelInitialSection(section)
    setCreateChannelDialogSeed((value) => value + 1)
    setShowCreateChannel(true)
  }

  const confirmDeleteAction = async () => {
    if (!pendingDeleteAction || !server || deleteSubmitting) return
    setDeleteSubmitting(true)
    try {
      if (pendingDeleteAction.kind === 'channel') {
        const { channel } = pendingDeleteAction
        await reducers.deleteChannel(channel.id)
        if (editingChannel?.id === channel.id) {
          setEditingChannel(null)
        }
        toast.success('Channel deleted')
      } else {
        const { group } = pendingDeleteAction
        await reducers.deleteChannelSection(server.id, group.section)
        if (editingChannel && group.channels.some((channel) => channel.id === editingChannel.id)) {
          setEditingChannel(null)
        }
        toast.success(`Deleted section "${sectionLabel(group.section)}"`)
      }
      setPendingDeleteAction(null)
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : pendingDeleteAction.kind === 'channel'
          ? 'Could not delete channel.'
          : 'Could not delete channel section.'
      toast.error(
        pendingDeleteAction.kind === 'channel' ? 'Failed to delete channel' : 'Failed to delete section',
        { description: message },
      )
    } finally {
      setDeleteSubmitting(false)
    }
  }

  const leaveServer = async () => {
    if (!Number.isFinite(numericServerId) || isOwner) return
    setLeaving(true)
    try {
      await reducers.leaveServer(numericServerId)
      toast.success('Left server')
      setActiveServerId(null)
      navigate('/app')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not leave server.'
      toast.error('Failed to leave server', { description: message })
    } finally {
      setLeaving(false)
    }
  }

  if (!Number.isFinite(numericServerId) || !server) {
    return (
      <Card className="h-full border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Server not found</CardTitle>
          <CardDescription>This server is unavailable or you no longer have access.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate('/app')}>
            Back to app
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (role === null) {
    return (
      <Card className="h-full border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Loading permissions...</CardTitle>
          <CardDescription>Checking access to server management.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (role === 'Member') {
    return <Navigate to={serverHomePath} replace />
  }

  return (
    <>
      <Card className="h-full border-border/70 bg-card/70">
        <CardContent className="flex h-full min-h-0 flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Server Panel</p>
              <div className="mt-0.5 flex items-center gap-2">
                <Avatar className="size-8 rounded-lg">
                  {server.iconUrl ? <AvatarImage src={server.iconUrl} alt={server.name} /> : null}
                  <AvatarFallback className="rounded-lg bg-primary/10 text-xs">{serverInitials(server.name)}</AvatarFallback>
                </Avatar>
                <h1 className="text-2xl font-semibold leading-tight">{server.name}</h1>
              </div>
              <p className="text-sm text-muted-foreground">Manage members, channels, and server settings in one place.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => navigate(serverHomePath)}>
                <ExternalLinkIcon className="size-4" />
                Open Server
              </Button>
            </div>
          </div>

          <Tabs defaultValue="members" className="min-h-0 flex-1 overflow-hidden">
            <TabsList className="w-full">
              <TabsTrigger value="members" className="flex-1">Members</TabsTrigger>
              <TabsTrigger value="channels" className="flex-1">Channels</TabsTrigger>
              <TabsTrigger value="server" className="flex-1">Server</TabsTrigger>
            </TabsList>

            <TabsContent value="members" className="min-h-0 flex-1">
              <Card className="flex h-full min-h-0 flex-col border-border/70 bg-background/40">
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle className="text-base">Members</CardTitle>
                    <CardDescription>
                      Roles, join dates, and moderation controls.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{sortedMembers.length}</Badge>
                    {canModerateMembers ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setMemberAction({ kind: 'banList' })}>
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
                                        <DropdownMenuItem onClick={() => void reducers.removeTimeout(server.id, member.userIdentity)}>
                                          <TimerOffIcon className="size-4" />
                                          Remove timeout
                                        </DropdownMenuItem>
                                      ) : (
                                        <DropdownMenuItem onClick={() => setMemberAction({ kind: 'timeout', member })}>
                                          <ClockIcon className="size-4" />
                                          Timeout
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem
                                        onClick={() => setMemberAction({ kind: 'kick', member })}
                                        className="text-destructive focus:text-destructive"
                                      >
                                        <UserMinusIcon className="size-4" />
                                        Kick
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => setMemberAction({ kind: 'ban', member })}
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
                                                onClick={() => setMemberAction({ kind: 'setRole', member, newRole: 'Member' })}
                                              >
                                                <ShieldOffIcon className="size-4" />
                                                Member
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                disabled={member.role === 'Moderator'}
                                                onClick={() => setMemberAction({ kind: 'setRole', member, newRole: 'Moderator' })}
                                              >
                                                <ShieldCheckIcon className="size-4" />
                                                Moderator
                                              </DropdownMenuItem>
                                            </DropdownMenuSubContent>
                                          </DropdownMenuSub>
                                          <DropdownMenuItem onClick={() => setMemberAction({ kind: 'transferOwnership', member })}>
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
            </TabsContent>

            <TabsContent value="channels" className="min-h-0 flex-1">
              <Card className="flex h-full min-h-0 flex-col border-border/70 bg-background/40">
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle className="text-base">Channels</CardTitle>
                    <CardDescription>Manage channels, sections, and ordering with explicit controls.</CardDescription>
                  </div>
                  {canManageServerChannels ? (
                    <Button type="button" size="sm" onClick={() => openCreateChannelDialog(null)}>
                      <PlusIcon className="size-4" />
                      Create Channel
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="min-h-0 flex-1 pt-0">
                  <ScrollArea className="h-full pr-2">
                    {sortedChannels.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">No channels found.</p>
                    ) : (
                      <div className="space-y-3">
                        {channelGroups.map((group) => (
                          <div key={group.key} className="rounded-lg border border-border/70 bg-muted/15">
                            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{sectionLabel(group.section)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary">{group.channels.length}</Badge>
                                {canManageServerChannels ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    onClick={() => openCreateChannelDialog(group.section)}
                                    aria-label={`Create channel in ${sectionLabel(group.section)}`}
                                    title={`Create channel in ${sectionLabel(group.section)}`}
                                  >
                                    <PlusIcon className="size-3.5" />
                                  </Button>
                                ) : null}
                                {canManageServerChannels ? (
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon-sm"
                                    onClick={() => void deleteChannelGroup(group)}
                                    aria-label="Delete entire section"
                                    title="Delete section and all channels"
                                  >
                                    <Trash2Icon className="size-3.5" />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[60px]">Order</TableHead>
                                  <TableHead>Name</TableHead>
                                  <TableHead>Access</TableHead>
                                  <TableHead className="w-[210px] text-right">Actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {group.channels.map((channel, index) => {
                                  return (
                                    <SortableChannelRow
                                      key={channel.id}
                                      channel={channel}
                                      orderLabel={index + 1}
                                      canMoveUp={index > 0}
                                      canMoveDown={index < group.channels.length - 1}
                                      canManageServerChannels={canManageServerChannels}
                                      isReordering={reorderingChannelId !== null}
                                      onMoveChannel={(channelId, direction) => {
                                        void moveChannel(channelId, direction)
                                      }}
                                      onDeleteChannel={deleteChannel}
                                      onManageChannel={(nextChannel) => setEditingChannel(nextChannel)}
                                    />
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="server" className="min-h-0 flex-1">
              <div className="grid gap-3 md:grid-cols-2">
                <Card className="border-border/70 bg-background/40">
                  <CardHeader>
                    <CardTitle className="text-base">Server Settings</CardTitle>
                    <CardDescription>Manage branding and invitation permissions.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5">
                      <p className="text-sm font-medium">Server Profile</p>
                      <p className="text-xs text-muted-foreground">Icon and name shown across rails, headers, and invites.</p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="size-12 rounded-xl">
                            {server.iconUrl ? <AvatarImage src={server.iconUrl} alt={server.name} /> : null}
                            <AvatarFallback className="rounded-xl bg-primary/10 text-sm">{serverInitials(server.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{server.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {server.iconUrl ? 'Custom icon enabled' : 'Using initials as fallback icon'}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!isOwner}
                          onClick={() => setShowEditServer(true)}
                        >
                          <Settings2Icon className="size-4" />
                          Edit Name/Icon
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5">
                      <p className="text-sm font-medium">Created</p>
                      <p className="text-sm text-muted-foreground">{formatMemberSince(server.createdAt)}</p>
                    </div>
                    <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                      <p className="text-sm font-medium">Who can invite users</p>
                      <Select
                        value={server.invitePolicy}
                        onValueChange={(value) => void updateInvitePolicy(value as ServerInvitePolicy)}
                        disabled={!isOwner || invitePolicySaving}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{invitePolicyLabel(server.invitePolicy)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ModeratorsOnly">Owner + Moderators</SelectItem>
                          <SelectItem value="Everyone">Everyone (all members)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {isOwner
                          ? 'This controls invite links and direct in-app invites.'
                          : 'Only the owner can change invite permissions.'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-destructive/35 bg-destructive/5 p-3.5">
                      <p className="text-sm font-medium text-destructive">Danger Zone</p>
                      <p className="mb-2 text-xs text-muted-foreground">Delete the entire server and all channels/messages.</p>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={!isOwner}
                        onClick={() => setShowDeleteServer(true)}
                      >
                        <Trash2Icon className="size-4" />
                        Delete Server
                      </Button>
                    </div>
                    {!isOwner ? (
                      <p className="text-xs text-muted-foreground">Only the server owner can edit branding or delete the server.</p>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-background/40">
                  <CardHeader>
                    <CardTitle className="text-base">Membership</CardTitle>
                    <CardDescription>Leave this server or transfer ownership first.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={isOwner || leaving}
                      onClick={() => void leaveServer()}
                    >
                      <LogOutIcon className="size-4" />
                      {leaving ? 'Leaving...' : 'Leave Server'}
                    </Button>
                    {isOwner ? (
                      <p className="text-xs text-muted-foreground">
                        Owners must transfer ownership in the Members tab before leaving.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={showEditServer} onOpenChange={setShowEditServer}>
        <DialogContent className="max-w-md">
          <EditServerModal
            serverId={server.id}
            currentName={server.name}
            currentIconUrl={server.iconUrl}
            onClose={() => setShowEditServer(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteServer} onOpenChange={setShowDeleteServer}>
        <DialogContent className="max-w-md">
          <DeleteServerModal
            serverId={server.id}
            serverName={server.name}
            onClose={() => setShowDeleteServer(false)}
            onDeleted={() => {
              setActiveServerId(null)
              navigate('/app')
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCreateChannel}
        onOpenChange={(open) => {
          setShowCreateChannel(open)
          if (!open) {
            setCreateChannelInitialSection(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <CreateChannelModal
            key={`${createChannelDialogSeed}:${createChannelInitialSection ?? '__none__'}`}
            serverId={server.id}
            initialSection={createChannelInitialSection}
            onClose={() => setShowCreateChannel(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={editingChannel !== null} onOpenChange={(open) => !open && setEditingChannel(null)}>
        <DialogContent className="max-w-md">
          {editingChannel ? (
            <EditChannelModal
              channelId={editingChannel.id}
              currentName={editingChannel.name}
              currentModeratorOnly={editingChannel.moderatorOnly}
              currentSection={editingChannel.section}
              onClose={() => setEditingChannel(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'kick'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'kick' ? (
            <KickMemberModal serverId={server.id} member={memberAction.member} onClose={closeMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'ban'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'ban' ? (
            <BanMemberModal serverId={server.id} member={memberAction.member} onClose={closeMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'timeout'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'timeout' ? (
            <TimeoutMemberModal serverId={server.id} member={memberAction.member} onClose={closeMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'setRole'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'setRole' ? (
            <SetRoleModal
              serverId={server.id}
              member={memberAction.member}
              newRole={memberAction.newRole}
              onClose={closeMemberAction}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'transferOwnership'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'transferOwnership' ? (
            <TransferOwnershipModal
              serverId={server.id}
              member={memberAction.member}
              onClose={closeMemberAction}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberAction?.kind === 'banList'} onOpenChange={(open) => !open && closeMemberAction()}>
        <DialogContent className="max-w-md">
          {memberAction?.kind === 'banList' ? (
            <BanListModal serverId={server.id} onClose={closeMemberAction} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeleteAction !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) setPendingDeleteAction(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDeleteAction?.kind === 'channel'
                ? `Delete channel "${pendingDeleteAction.channel.name}"?`
                : pendingDeleteAction?.kind === 'section'
                  ? `Delete section "${sectionLabel(pendingDeleteAction.group.section)}"?`
                  : 'Delete item?'}
            </DialogTitle>
            <DialogDescription>
              {pendingDeleteAction?.kind === 'channel'
                ? 'This will permanently remove the channel and its messages.'
                : pendingDeleteAction?.kind === 'section'
                  ? `This will delete all ${pendingDeleteAction.group.channels.length} channels in this section and their messages.`
                  : 'This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDeleteAction(null)}
              disabled={deleteSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDeleteAction()}
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
