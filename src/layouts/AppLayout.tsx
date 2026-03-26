import { useEffect, useMemo, useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import { PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react'
import { useServerRole } from '../hooks/useServerRole'
import { useChannelsStore } from '../stores/channelsStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useDmStore } from '../stores/dmStore'
import { useFriendsStore } from '../stores/friendsStore'
import { useMembersStore } from '../stores/membersStore'
import { useServersStore } from '../stores/serversStore'
import { useUiStore } from '../stores/uiStore'
import { useUsersStore } from '../stores/usersStore'
import { useDmVoiceStore } from '../stores/dmVoiceStore'
import { useDmVoiceSessionStore } from '../stores/dmVoiceSessionStore'
import { useVoiceSessionStore } from '../stores/voiceSessionStore'
import { useVoiceStore } from '../stores/voiceStore'
import { normalizeIdentity } from './app-layout/helpers'
import { ComposeDmDialog } from './app-layout/ComposeDmDialog'
import { LayoutModals } from './app-layout/LayoutModals'
import { MemberPanel } from './app-layout/MemberPanel'
import { ServerRail } from './app-layout/ServerRail'
import { ServerSidebar } from './app-layout/ServerSidebar'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { Channel } from '../types/domain'

const EMPTY_CHANNELS: Channel[] = []

export function AppLayout() {
  const navigate = useNavigate()
  const params = useParams()
  const [showCreateServer, setShowCreateServer] = useState(false)
  const [showEditServer, setShowEditServer] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showComposeDm, setShowComposeDm] = useState(false)

  const servers = useServersStore((s) => s.servers)
  const setActiveServerId = useServersStore((s) => s.setActiveServerId)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const membersByServer = useMembersStore((s) => s.membersByServer)
  const unreadByChannel = useUiStore((s) => s.unreadByChannel)
  const participantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const conversations = useDmStore((s) => s.conversations)
  const friends = useFriendsStore((s) => s.friends)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
  const dmVoiceParticipantsByRoom = useDmVoiceStore((s) => s.participantsByRoom)
  const dmJoinedPartnerIdentity = useDmVoiceSessionStore((s) => s.joinedPartnerIdentity)
  const dmVoiceJoining = useDmVoiceSessionStore((s) => s.joining)
  const joinedVoiceChannelId = useVoiceSessionStore((s) => s.joinedChannelId)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const activeServerId = Number(params.serverId ?? 0) || null
  const activeChannelId = Number(params.channelId ?? 0) || null
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)
  const setActiveDmPartner = useUiStore((s) => s.setActiveDmPartner)
  const clearUnread = useUiStore((s) => s.clearUnread)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const role = useServerRole(activeServerId)
  const activeDmIdentity = params.identity && params.identity !== 'friends' ? params.identity : null
  const normalizedSelfIdentity = selfIdentity ? normalizeIdentity(selfIdentity) : null

  useEffect(() => {
    if (activeServerId !== null) {
      setActiveServerId(activeServerId)
    }
  }, [activeServerId, setActiveServerId])

  useEffect(() => {
    if (activeChannelId !== null) {
      setActiveChannelId(activeChannelId)
    }
  }, [activeChannelId, setActiveChannelId])

  useEffect(() => {
    setActiveDmPartner(activeDmIdentity)
  }, [activeDmIdentity, setActiveDmPartner])

  const activeChannels = useMemo(
    () => (activeServerId ? channelsByServer[activeServerId] ?? EMPTY_CHANNELS : EMPTY_CHANNELS),
    [activeServerId, channelsByServer],
  )
  const textChannels = useMemo(
    () => [...activeChannels].filter((c) => c.kind === 'Text').sort((a, b) => a.position - b.position),
    [activeChannels],
  )
  const voiceChannels = useMemo(
    () => [...activeChannels].filter((c) => c.kind === 'Voice').sort((a, b) => a.position - b.position),
    [activeChannels],
  )
  const activeServer = servers.find((server) => server.id === activeServerId) ?? null
  const activeServerMembers = useMemo(
    () => (activeServerId ? membersByServer[activeServerId] ?? [] : []),
    [activeServerId, membersByServer],
  )
  const dmFriends = useMemo(() => {
    if (!selfIdentity) return []

    const acceptedFriends = friends.filter((friend) => friend.status === 'Accepted')
    const seen = new Set<string>()
    const contacts: Array<{
      identity: string
      label: string
      username: string
      avatarUrl: string | null
      lastMessagePreview: string
      lastMessageAt: string | null
      lastActivityAt: string | null
      online: boolean
    }> = []

    for (const friend of acceptedFriends) {
      const other =
        normalizeIdentity(friend.userA) === normalizeIdentity(selfIdentity) ? friend.userB
        : normalizeIdentity(friend.userB) === normalizeIdentity(selfIdentity) ? friend.userA
        : null
      if (!other) continue

      const key = normalizeIdentity(other)
      if (seen.has(key)) continue
      seen.add(key)

      const knownUser = Object.values(usersByIdentity).find((user) => normalizeIdentity(user.identity) === key)
      const thread = conversations[other] ?? []
      const lastMessage = thread.length > 0 ? thread[thread.length - 1] : null
      contacts.push({
        identity: other,
        label: knownUser?.displayName || knownUser?.username || other.slice(0, 14),
        username: knownUser?.username || other.slice(0, 12),
        avatarUrl: knownUser?.avatarUrl ?? null,
        lastMessagePreview: lastMessage?.content || 'No messages yet',
        lastMessageAt: lastMessage?.sentAt ?? null,
        lastActivityAt: lastMessage?.sentAt ?? friend.updatedAt,
        online: false,
      })
    }

    contacts.sort((a, b) => {
      const aTime = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0
      const bTime = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0
      return bTime - aTime
    })

    return contacts.map(({ lastActivityAt: _lastActivityAt, ...contact }) => contact)
  }, [conversations, friends, selfIdentity, usersByIdentity])

  const dmContacts = useMemo(
    () => dmFriends.filter((contact) => contact.lastMessageAt !== null),
    [dmFriends],
  )
  const memberProfileByIdentity = useMemo(() => {
    const map = new Map<string, { label: string; avatarUrl: string | null }>()
    for (const member of activeServerMembers) {
      const key = normalizeIdentity(member.userIdentity)
      const label = member.user?.displayName || member.user?.username || member.userIdentity.slice(0, 10)
      map.set(key, { label, avatarUrl: member.user?.avatarUrl ?? null })
    }
    return map
  }, [activeServerMembers])

  const dmCallActiveByIdentity = useMemo(() => {
    const result: Record<string, boolean> = {}
    if (!selfIdentity) return result
    const me = normalizeIdentity(selfIdentity)
    const joinedPartnerKey = dmJoinedPartnerIdentity ? normalizeIdentity(dmJoinedPartnerIdentity) : null
    for (const contact of dmFriends) {
      const other = normalizeIdentity(contact.identity)
      const roomKey = me <= other ? `${me}:${other}` : `${other}:${me}`
      const participants = dmVoiceParticipantsByRoom[roomKey] ?? []
      const selfInRoom = participants.some((participant) => normalizeIdentity(participant.userIdentity) === me)
      result[contact.identity] = selfInRoom || joinedPartnerKey === other
    }
    return result
  }, [dmFriends, dmJoinedPartnerIdentity, dmVoiceParticipantsByRoom, selfIdentity])

  const hasActiveDmCall = useMemo(
    () => dmVoiceJoining || Object.values(dmCallActiveByIdentity).some(Boolean),
    [dmCallActiveByIdentity, dmVoiceJoining],
  )

  const dmContactsWithPresence = useMemo(
    () =>
      dmContacts.map((contact) => ({
        ...contact,
        online: dmCallActiveByIdentity[contact.identity] ?? false,
      })),
    [dmCallActiveByIdentity, dmContacts],
  )

  const dmFriendsWithPresence = useMemo(
    () =>
      dmFriends.map((friend) => ({
        ...friend,
        online: dmCallActiveByIdentity[friend.identity] ?? false,
      })),
    [dmCallActiveByIdentity, dmFriends],
  )

  const quickDmContacts = useMemo(
    () => (dmContactsWithPresence.length > 0 ? dmContactsWithPresence : dmFriendsWithPresence).slice(0, 4),
    [dmContactsWithPresence, dmFriendsWithPresence],
  )

  const hasUnreadInServer = (serverId: number) =>
    (channelsByServer[serverId] ?? []).some((channel) => (unreadByChannel[channel.id] ?? 0) > 0)

  const hasVoiceActivityInServer = (serverId: number): boolean => {
    if (!selfIdentity) return false
    const voiceChannelIds = (channelsByServer[serverId] ?? []).filter((channel) => channel.kind === 'Voice').map((channel) => channel.id)
    if (voiceChannelIds.length === 0) return false

    if (joinedVoiceChannelId !== null && voiceChannelIds.includes(joinedVoiceChannelId)) {
      return true
    }
    return false
  }

  const openChannel = (serverId: number, channelId: number) => {
    setActiveServerId(serverId)
    setActiveChannelId(channelId)
    clearUnread(channelId)
    navigate(`/app/${serverId}/${channelId}`)
  }

  const openServer = (serverId: number) => {
    const channels = channelsByServer[serverId] ?? []
    const preferred = channels.find((channel) => channel.kind === 'Text') ?? channels[0]
    if (!preferred) {
      setActiveServerId(serverId)
      navigate(`/app/${serverId}`)
      return
    }
    openChannel(serverId, preferred.id)
  }

  return (
    <>
      <main className="min-h-screen bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/25),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/20),transparent)] p-3 text-foreground">
        <div className="grid h-[calc(100vh-1.5rem)] grid-cols-[48px_220px_minmax(0,1fr)] gap-3 max-md:grid-cols-[48px_minmax(0,1fr)]">
          <ServerRail
            servers={servers}
            activeServerId={activeServerId}
            activeDmIdentity={activeDmIdentity}
            quickDmContacts={quickDmContacts}
            onOpenHome={() => navigate('/app')}
            onOpenServer={openServer}
            onOpenDmHome={() => navigate('/app/dm/friends')}
            onOpenDmCompose={() => setShowComposeDm(true)}
            onOpenDmContact={(identity) => navigate(`/app/dm/${identity}`)}
            onOpenCreateServer={() => setShowCreateServer(true)}
            onOpenSettings={() => setShowSettings(true)}
            hasUnreadInServer={hasUnreadInServer}
            hasVoiceActivityInServer={hasVoiceActivityInServer}
            hasActiveDmCall={hasActiveDmCall}
          />

          <ServerSidebar
            activeServerId={activeServerId}
            activeServer={activeServer}
            activeChannelId={activeChannelId}
            role={role}
            textChannels={textChannels}
            voiceChannels={voiceChannels}
            activeChannelsCount={activeChannels.length}
            unreadByChannel={unreadByChannel}
            participantsByChannel={participantsByChannel}
            joinedVoiceChannelId={joinedVoiceChannelId}
            normalizedSelfIdentity={normalizedSelfIdentity}
            memberProfileByIdentity={memberProfileByIdentity}
            onOpenRenameServer={() => setShowEditServer(true)}
            onOpenInvite={() => setShowInvite(true)}
            onOpenCreateChannel={() => setShowCreateChannel(true)}
            onSelectChannel={(channelId) => {
              if (activeServerId === null) return
              openChannel(activeServerId, channelId)
            }}
            onOpenFriends={() => navigate('/app/dm/friends')}
            dmContacts={dmContactsWithPresence}
            dmFriends={dmFriendsWithPresence}
            activeDmIdentity={activeDmIdentity}
            dmCallActiveByIdentity={dmCallActiveByIdentity}
            onOpenDmContact={(identity) => navigate(`/app/dm/${identity}`)}
          />

          <div className={cn('grid min-w-0 gap-3', rightPanelOpen && activeServerId ? 'grid-cols-[minmax(0,1fr)_240px]' : 'grid-cols-1')}>
            <Card className="relative border-border/60 bg-card/80 backdrop-blur">
              {activeServerId ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="absolute right-3 top-3 z-20 h-8 gap-1.5"
                  onClick={toggleRightPanel}
                >
                  {rightPanelOpen ? <PanelRightCloseIcon className="size-4" /> : <PanelRightOpenIcon className="size-4" />}
                  Members
                </Button>
              ) : null}
              <CardContent className={cn('h-full p-3', activeServerId ? 'pt-12' : '')}>
                <Outlet />
              </CardContent>
            </Card>

            {rightPanelOpen && activeServerId ? (
              <MemberPanel members={activeServerMembers} selfIdentity={selfIdentity} />
            ) : null}
          </div>
        </div>
      </main>

      <LayoutModals
        showCreateServer={showCreateServer}
        showEditServer={showEditServer}
        showCreateChannel={showCreateChannel}
        showInvite={showInvite}
        showSettings={showSettings}
        activeServerId={activeServerId}
        activeServer={activeServer}
        setShowCreateServer={setShowCreateServer}
        setShowEditServer={setShowEditServer}
        setShowCreateChannel={setShowCreateChannel}
        setShowInvite={setShowInvite}
        setShowSettings={setShowSettings}
      />

      <ComposeDmDialog
        open={showComposeDm}
        onOpenChange={setShowComposeDm}
        friends={dmFriendsWithPresence}
        onSelectFriend={(identity) => navigate(`/app/dm/${identity}`)}
      />
    </>
  )
}
