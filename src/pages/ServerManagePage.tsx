import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ExternalLinkIcon } from 'lucide-react'
import { reducers } from '../lib/spacetimedb'
import { useChannelsStore } from '../stores/channelsStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useMembersStore, type ServerMemberWithUser } from '../stores/membersStore'
import { useServersStore } from '../stores/serversStore'
import { useServerRole } from '../hooks/useServerRole'
import { canManageChannels } from '../lib/permissions'
import type { Channel, ServerInvitePolicy } from '../types/domain'
import { ChannelsTab } from '../features/server-manage/ChannelsTab'
import { MembersTab } from '../features/server-manage/MembersTab'
import { ServerTab } from '../features/server-manage/ServerTab'
import { ServerManageDialogs } from '../features/server-manage/Dialogs'
import { channelGroupKey, memberLabel, sectionKey, sectionLabel } from '../features/server-manage/helpers'
import type { ChannelGroup, MemberActionModal, PendingDeleteAction } from '../features/server-manage/types'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/sonner'
import { serverInitials } from '../layouts/app-layout/helpers'

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
              <MembersTab
                role={role}
                serverId={server.id}
                sortedMembers={sortedMembers}
                selfIdentity={selfIdentity}
                canModerateMembers={canModerateMembers}
                isOwner={isOwner}
                onSetMemberAction={setMemberAction}
              />
            </TabsContent>

            <TabsContent value="channels" className="min-h-0 flex-1">
              <ChannelsTab
                sortedChannels={sortedChannels}
                channelGroups={channelGroups}
                canManageServerChannels={canManageServerChannels}
                reorderingChannelId={reorderingChannelId}
                onOpenCreateChannelDialog={openCreateChannelDialog}
                onDeleteChannelGroup={deleteChannelGroup}
                onMoveChannel={(channelId, direction) => {
                  void moveChannel(channelId, direction)
                }}
                onDeleteChannel={deleteChannel}
                onManageChannel={setEditingChannel}
              />
            </TabsContent>

            <TabsContent value="server" className="min-h-0 flex-1">
              <ServerTab
                server={server}
                isOwner={isOwner}
                leaving={leaving}
                invitePolicySaving={invitePolicySaving}
                onOpenEditServer={() => setShowEditServer(true)}
                onOpenDeleteServer={() => setShowDeleteServer(true)}
                onLeaveServer={() => {
                  void leaveServer()
                }}
                onUpdateInvitePolicy={(value) => {
                  void updateInvitePolicy(value)
                }}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ServerManageDialogs
        server={server}
        showEditServer={showEditServer}
        setShowEditServer={setShowEditServer}
        showDeleteServer={showDeleteServer}
        setShowDeleteServer={setShowDeleteServer}
        showCreateChannel={showCreateChannel}
        setShowCreateChannel={setShowCreateChannel}
        createChannelInitialSection={createChannelInitialSection}
        setCreateChannelInitialSection={setCreateChannelInitialSection}
        createChannelDialogSeed={createChannelDialogSeed}
        editingChannel={editingChannel}
        setEditingChannel={setEditingChannel}
        memberAction={memberAction}
        onCloseMemberAction={closeMemberAction}
        pendingDeleteAction={pendingDeleteAction}
        setPendingDeleteAction={setPendingDeleteAction}
        deleteSubmitting={deleteSubmitting}
        onConfirmDeleteAction={() => {
          void confirmDeleteAction()
        }}
        onServerDeleted={() => {
          setActiveServerId(null)
          navigate('/app')
        }}
      />
    </>
  )
}
