import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Track } from 'livekit-client'
import { AWAY_AFTER_MS, type UserPresenceStatus } from '../hooks/useUserPresentation'
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
import { usePresenceStore } from '../stores/presenceStore'
import { useVoiceSessionStore } from '../stores/voiceSessionStore'
import { useVoiceStore } from '../stores/voiceStore'
import { normalizeIdentity } from './app-layout/helpers'
import { useIncomingDmRing } from '../features/dm/hooks/useIncomingDmRing'
import { formatDmPreview } from '../features/dm/systemMessages'
import { useLiveKitRoom } from '../lib/livekit'
import { reducers } from '../lib/spacetimedb'
import { syncUnreadBadgeCount } from '../lib/notifications'
import { ComposeDmDialog } from './app-layout/ComposeDmDialog'
import { LayoutModals, type MemberActionModal } from './app-layout/LayoutModals'
import { MemberPanel } from './app-layout/MemberPanel'
import { ActiveCallCard } from './app-layout/ActiveCallCard'
import { AppRail } from './app-layout/AppRail'
import { ChannelBar } from './app-layout/ChannelBar'
import { cn } from '../lib/utils'
import { useIsMobile } from '../hooks/use-mobile'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from '@/components/ui/sonner'
import type { Channel } from '../types/domain'

const EMPTY_CHANNELS: Channel[] = []
const CHANNEL_BAR_MIN_WIDTH = 220
const CHANNEL_BAR_MAX_WIDTH = Math.round(CHANNEL_BAR_MIN_WIDTH * 1.7)
const CHANNEL_BAR_WIDTH_STORAGE_KEY = 'letschat.channel-bar-width'

function clampChannelBarWidth(value: number): number {
  if (!Number.isFinite(value)) return CHANNEL_BAR_MIN_WIDTH
  return Math.min(CHANNEL_BAR_MAX_WIDTH, Math.max(CHANNEL_BAR_MIN_WIDTH, Math.round(value)))
}

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const [showCreateServer, setShowCreateServer] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showComposeDm, setShowComposeDm] = useState(false)
  const [memberAction, setMemberAction] = useState<MemberActionModal | null>(null)
  const [channelBarWidth, setChannelBarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return CHANNEL_BAR_MIN_WIDTH
    const stored = window.localStorage.getItem(CHANNEL_BAR_WIDTH_STORAGE_KEY)
    const parsed = stored ? Number(stored) : CHANNEL_BAR_MIN_WIDTH
    return clampChannelBarWidth(parsed)
  })

  const servers = useServersStore((s) => s.servers)
  const setActiveServerId = useServersStore((s) => s.setActiveServerId)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const membersByServer = useMembersStore((s) => s.membersByServer)
  const unreadByChannel = useUiStore((s) => s.unreadByChannel)
  const unreadByDmPartner = useUiStore((s) => s.unreadByDmPartner)
  const mutedChannels = useUiStore((s) => s.mutedChannels)
  const mutedUsers = useUiStore((s) => s.mutedUsers)
  const clearDmUnread = useUiStore((s) => s.clearDmUnread)
  const toggleMutedChannel = useUiStore((s) => s.toggleMutedChannel)
  const toggleMutedUser = useUiStore((s) => s.toggleMutedUser)
  const participantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const conversations = useDmStore((s) => s.conversations)
  const friends = useFriendsStore((s) => s.friends)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
  const dmVoiceParticipantsByRoom = useDmVoiceStore((s) => s.participantsByRoom)
  const dmJoinedPartnerIdentity = useDmVoiceSessionStore((s) => s.joinedPartnerIdentity)
  const dmVoiceJoining = useDmVoiceSessionStore((s) => s.joining)
  const dmVoiceRoom = useDmVoiceSessionStore((s) => s.room)
  const joinedVoiceChannelId = useVoiceSessionStore((s) => s.joinedChannelId)
  const voiceRoom = useVoiceSessionStore((s) => s.room)
  const voiceJoining = useVoiceSessionStore((s) => s.joining)
  const connectionStatus = useConnectionStore((s) => s.status)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const activeServerId = Number(params.serverId ?? 0) || null
  const activeChannelId = Number(params.channelId ?? 0) || null
  const setActiveChannelId = useUiStore((s) => s.setActiveChannelId)
  const setActiveDmPartner = useUiStore((s) => s.setActiveDmPartner)
  const setActiveCallDockVisible = useUiStore((s) => s.setActiveCallDockVisible)
  const clearUnread = useUiStore((s) => s.clearUnread)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const role = useServerRole(activeServerId)
  const isMobile = useIsMobile()
  const activeDmIdentity = params.identity && params.identity !== 'friends' ? params.identity : null
  const isSettingsPage = location.pathname.startsWith('/app/settings')
  const isServerManagePage = /^\/app\/[^/]+\/manage\/?$/.test(location.pathname)
  const normalizedSelfIdentity = selfIdentity ? normalizeIdentity(selfIdentity) : null

  useEffect(() => {
    if (activeServerId !== null) {
      setActiveServerId(activeServerId)
    }
  }, [activeServerId, setActiveServerId])

  useEffect(() => {
    setActiveChannelId(activeChannelId)
  }, [activeChannelId, setActiveChannelId])

  useEffect(() => {
    if (activeChannelId !== null) {
      clearUnread(activeChannelId)
    }
  }, [activeChannelId, clearUnread])

  useEffect(() => {
    setActiveDmPartner(activeDmIdentity)
    if (activeDmIdentity) {
      clearDmUnread(activeDmIdentity)
    }
  }, [activeDmIdentity, clearDmUnread, setActiveDmPartner])

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
      status: UserPresenceStatus
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
        lastMessagePreview: lastMessage ? formatDmPreview(lastMessage.content) : 'No messages yet',
        lastMessageAt: lastMessage?.sentAt ?? null,
        lastActivityAt: lastMessage?.sentAt ?? friend.updatedAt,
        status: 'offline',
      })
    }

    contacts.sort((a, b) => {
      const aTime = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0
      const bTime = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0
      return bTime - aTime
    })

    return contacts.map((contact) => ({
      identity: contact.identity,
      label: contact.label,
      username: contact.username,
      avatarUrl: contact.avatarUrl,
      lastMessagePreview: contact.lastMessagePreview,
      lastMessageAt: contact.lastMessageAt,
      status: contact.status,
    }))
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

  const nowMs = usePresenceStore((s) => s.nowMs)
  const onlineByIdentity = usePresenceStore((s) => s.onlineByIdentity)
  const lastActiveByIdentity = usePresenceStore((s) => s.lastActiveByIdentity)

  const resolveDmPresenceStatus = useCallback((
    identity: string,
    fallbackSeenAtMs: number | null = null,
  ): UserPresenceStatus => {
    const normalizedIdentity = normalizeIdentity(identity)
    const isSelf =
      normalizedSelfIdentity !== null && normalizedSelfIdentity === normalizedIdentity
    const presenceOnline = onlineByIdentity[normalizedIdentity] ?? false
    const presenceActiveAt = lastActiveByIdentity[normalizedIdentity] ?? 0
    const fallbackSeen = fallbackSeenAtMs ?? 0
    const lastActiveAt = Math.max(presenceActiveAt, fallbackSeen)
    const inActiveDmCall = dmCallActiveByIdentity[identity] ?? false
    const connected = isSelf
      ? connectionStatus === 'connected'
      : inActiveDmCall || presenceOnline

    if (!connected) return 'offline'
    const effectiveLastActiveAt = lastActiveAt > 0 ? lastActiveAt : nowMs
    return nowMs - effectiveLastActiveAt > AWAY_AFTER_MS ? 'away' : 'online'
  }, [connectionStatus, dmCallActiveByIdentity, lastActiveByIdentity, normalizedSelfIdentity, nowMs, onlineByIdentity])

  useIncomingDmRing({
    participantsByRoom: dmVoiceParticipantsByRoom,
    usersByIdentity,
    selfIdentity,
    mutedUsers,
    activeDmIdentity,
    joinedDmPartnerIdentity: dmJoinedPartnerIdentity,
    dmJoining: dmVoiceJoining,
    onOpenDm: (identity) => navigate(`/app/dm/${identity}`),
  })

  const dmContactsWithPresence = useMemo(
    () =>
      dmContacts.map((contact) => ({
        ...contact,
        status: resolveDmPresenceStatus(
          contact.identity,
          contact.lastMessageAt ? Date.parse(contact.lastMessageAt) : null,
        ),
      })),
    [dmContacts, resolveDmPresenceStatus],
  )

  const dmFriendsWithPresence = useMemo(
    () =>
      dmFriends.map((friend) => ({
        ...friend,
        status: resolveDmPresenceStatus(
          friend.identity,
          friend.lastMessageAt ? Date.parse(friend.lastMessageAt) : null,
        ),
      })),
    [dmFriends, resolveDmPresenceStatus],
  )

  const quickDmContacts = useMemo(
    () => (dmContactsWithPresence.length > 0 ? dmContactsWithPresence : dmFriendsWithPresence).slice(0, 4),
    [dmContactsWithPresence, dmFriendsWithPresence],
  )

  useEffect(() => {
    const knownChannelIds = new Set<number>()
    for (const channels of Object.values(channelsByServer)) {
      for (const channel of channels) {
        knownChannelIds.add(channel.id)
      }
    }
    for (const [channelIdKey, unread] of Object.entries(unreadByChannel)) {
      if (unread <= 0) continue
      const channelId = Number(channelIdKey)
      if (!Number.isFinite(channelId) || !knownChannelIds.has(channelId)) {
        clearUnread(channelId)
      }
    }

    const knownDmIdentities = new Set<string>()
    for (const contact of dmFriends) {
      knownDmIdentities.add(normalizeIdentity(contact.identity))
    }
    for (const dmIdentity of Object.keys(conversations)) {
      knownDmIdentities.add(normalizeIdentity(dmIdentity))
    }
    for (const [dmIdentity, unread] of Object.entries(unreadByDmPartner)) {
      if (unread <= 0) continue
      if (!knownDmIdentities.has(normalizeIdentity(dmIdentity))) {
        clearDmUnread(dmIdentity)
      }
    }
  }, [channelsByServer, clearDmUnread, clearUnread, conversations, dmFriends, unreadByChannel, unreadByDmPartner])

  const hasUnreadInServer = (serverId: number) =>
    (channelsByServer[serverId] ?? []).some((channel) => (unreadByChannel[channel.id] ?? 0) > 0)

  const countUnreadInServer = (serverId: number) =>
    (channelsByServer[serverId] ?? []).reduce((total, channel) => total + (unreadByChannel[channel.id] ?? 0), 0)

  const countUnreadInDm = () =>
    Object.values(unreadByDmPartner).reduce((total, value) => total + value, 0)

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

  const openServerPanel = useCallback(() => {
    if (!activeServerId) return
    navigate(`/app/${activeServerId}/manage`)
  }, [activeServerId, navigate])

  const leaveActiveServer = useCallback(async () => {
    if (!activeServerId) return
    try {
      await reducers.leaveServer(activeServerId)
      toast.success('Left server')
      setActiveServerId(null)
      navigate('/app')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not leave server.'
      toast.error('Failed to leave server', { description: message })
    }
  }, [activeServerId, navigate, setActiveServerId])

  const hasActiveCallDock =
    joinedVoiceChannelId !== null ||
    dmJoinedPartnerIdentity !== null ||
    voiceRoom !== null ||
    dmVoiceRoom !== null ||
    voiceJoining ||
    dmVoiceJoining
  const activeCallDockVisible = hasActiveCallDock && !isMobile
  const {
    activeSpeakerIds: roomActiveSpeakerIds,
    localParticipant: roomLocalParticipant,
    remoteParticipants: roomRemoteParticipants,
  } = useLiveKitRoom(voiceRoom)
  const activeSpeakerIdentityKeys = useMemo(
    () => {
      const activeKeys = Array.from(roomActiveSpeakerIds).map((identity) => normalizeIdentity(identity))
      const result = new Set<string>()

      for (const activeKey of activeKeys) {
        const localMatch =
          roomLocalParticipant && normalizeIdentity(roomLocalParticipant.identity) === activeKey
            ? roomLocalParticipant
            : null
        const participant =
          localMatch ??
          roomRemoteParticipants.find((remoteParticipant) => normalizeIdentity(remoteParticipant.identity) === activeKey)
        const hasMicrophoneTrack = Boolean(
          participant?.getTrackPublication(Track.Source.Microphone)?.audioTrack,
        )
        if (hasMicrophoneTrack) {
          result.add(activeKey)
        }
      }
      return result
    },
    [roomActiveSpeakerIds, roomLocalParticipant, roomRemoteParticipants],
  )

  useEffect(() => {
    setActiveCallDockVisible(activeCallDockVisible)
  }, [activeCallDockVisible, setActiveCallDockVisible])

  useEffect(() => {
    void syncUnreadBadgeCount()
  }, [unreadByChannel, unreadByDmPartner])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CHANNEL_BAR_WIDTH_STORAGE_KEY, String(channelBarWidth))
  }, [channelBarWidth])

  const onChannelBarResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (isMobile) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = channelBarWidth

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX
      setChannelBarWidth(clampChannelBarWidth(startWidth + delta))
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
  }, [channelBarWidth, isMobile])

  const mainPane = (
    <div className={cn('grid min-h-0 min-w-0 gap-3 overflow-hidden', rightPanelOpen && activeServerId && !isServerManagePage ? 'grid-cols-[minmax(0,1fr)_240px]' : 'grid-cols-1')}>
      <Card className="relative h-full min-h-0 border-border/60 bg-card/80 backdrop-blur">
        <CardContent className="h-full min-h-0 overflow-hidden p-2 sm:p-3">
          <Outlet />
        </CardContent>
      </Card>

      {rightPanelOpen && activeServerId && !isServerManagePage ? (
        <MemberPanel
          members={activeServerMembers}
          selfIdentity={selfIdentity}
          selfRole={role}
          serverId={activeServerId}
          onKick={(member) => setMemberAction({ kind: 'kick', member })}
          onBan={(member) => setMemberAction({ kind: 'ban', member })}
          onTimeout={(member) => setMemberAction({ kind: 'timeout', member })}
          onRemoveTimeout={async (member) => {
            const { reducers } = await import('../lib/spacetimedb')
            await reducers.removeTimeout(activeServerId, member.userIdentity)
          }}
          onSetRole={(member, newRole) => setMemberAction({ kind: 'setRole', member, newRole })}
          onTransferOwnership={(member) => setMemberAction({ kind: 'transferOwnership', member })}
        />
      ) : null}
    </div>
  )

  return (
    <>
      <main
        className="relative h-screen overflow-hidden bg-background p-2 text-foreground"
        style={{ ['--channel-bar-width' as string]: `${channelBarWidth}px` }}
      >
        <div
          className={cn(
            'grid h-full min-h-0 grid-rows-1 gap-2 overflow-hidden',
            isSettingsPage
              ? 'grid-cols-[48px_minmax(0,1fr)]'
              : 'grid-cols-[48px_var(--channel-bar-width)_minmax(0,1fr)] max-md:grid-cols-[48px_minmax(0,1fr)]',
          )}
        >
          <AppRail
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
            onOpenSettings={() => navigate('/app/settings')}
            isSettingsActive={isSettingsPage}
            hasUnreadInServer={hasUnreadInServer}
            countUnreadInServer={countUnreadInServer}
            countUnreadInDm={countUnreadInDm}
            dmUnreadByIdentity={unreadByDmPartner}
            hasVoiceActivityInServer={hasVoiceActivityInServer}
            dmCallActiveByIdentity={dmCallActiveByIdentity}
          />

          {isSettingsPage ? null : (
            <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
              <div className="relative min-h-0 min-w-0">
                <ChannelBar
                  channelBarWidth={channelBarWidth}
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
                  activeSpeakerIdentityKeys={activeSpeakerIdentityKeys}
                  memberProfileByIdentity={memberProfileByIdentity}
                  onOpenInvite={() => setShowInvite(true)}
                  onOpenCreateChannel={() => setShowCreateChannel(true)}
                  onOpenServerPanel={openServerPanel}
                  onLeaveServer={() => void leaveActiveServer()}
                  isChannelMuted={(channelId) => Boolean(mutedChannels[channelId])}
                  onToggleChannelMute={(channelId) => toggleMutedChannel(channelId)}
                  onSelectChannel={(channelId) => {
                    if (activeServerId === null) return
                    openChannel(activeServerId, channelId)
                  }}
                  onOpenFriends={() => navigate('/app/dm/friends')}
                  dmContacts={dmContactsWithPresence}
                  dmUnreadByIdentity={unreadByDmPartner}
                  isUserMuted={(identity) => Boolean(mutedUsers[normalizeIdentity(identity)])}
                  onToggleUserMute={(identity) => toggleMutedUser(normalizeIdentity(identity))}
                  activeDmIdentity={activeDmIdentity}
                  dmCallActiveByIdentity={dmCallActiveByIdentity}
                  onOpenDmContact={(identity) => navigate(`/app/dm/${identity}`)}
                />
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize channel bar"
                  className="group absolute right-0 top-3 z-20 h-[calc(100%-1.5rem)] w-0.75 cursor-col-resize max-md:hidden"
                  onPointerDown={onChannelBarResizeStart}
                  onDoubleClick={() => setChannelBarWidth(CHANNEL_BAR_MIN_WIDTH)}
                >
                  <div className="h-full w-full rounded-full bg-border/60 shadow-[0_0_0_1px_hsl(var(--background)/0.95)] transition-colors group-hover:bg-primary/55" />
                </div>
              </div>

              {activeCallDockVisible ? (
                <ActiveCallCard
                  variant="sidebar"
                  className="max-md:hidden"
                />
              ) : null}
            </div>
          )}

          {mainPane}
        </div>
      </main>

      <LayoutModals
        showCreateServer={showCreateServer}
        showCreateChannel={showCreateChannel}
        showInvite={showInvite}
        memberAction={memberAction}
        activeServerId={activeServerId}
        setShowCreateServer={setShowCreateServer}
        setShowCreateChannel={setShowCreateChannel}
        setShowInvite={setShowInvite}
        setMemberAction={setMemberAction}
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
