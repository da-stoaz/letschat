import { useEffect, useMemo, useRef } from 'react'
import type { LocalParticipant, RemoteParticipant } from 'livekit-client'
import {
  getMicrophoneUnavailableReason,
  joinLiveKitVoice,
  leaveLiveKitVoice,
  supportsMicrophoneCapture,
  supportsScreenCapture,
  useLiveKitRoom,
} from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { useChannelsStore } from '../../stores/channelsStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMediaDeviceStore } from '../../stores/mediaDeviceStore'
import { useMembersStore } from '../../stores/membersStore'
import { useVoiceSessionStore } from '../../stores/voiceSessionStore'
import type { VoiceParticipant, u64 } from '../../types/domain'
import { ConnectionState } from 'livekit-client'
import { PhoneCallIcon, PhoneOffIcon } from 'lucide-react'
import { warnOnce } from '../../lib/devWarnings'
import { useOngoingCallDuration } from './hooks/useOngoingCallDuration'
import { VoiceControlBar } from './components/VoiceControlBar'
import { useLegacyCallControlsVisible } from './hooks/useLegacyCallControls'
import { useVoiceControlActions } from './hooks/useVoiceControlActions'
import { VoiceMediaStage, type VoiceMediaTile } from './components/VoiceMediaStage'
import { buildVoiceMediaTiles } from './mediaTiles'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const EMPTY_PARTICIPANTS: VoiceParticipant[] = []

function normalizeIdentityKey(value: string): string {
  return value.trim().toLowerCase()
}

function sameIdentity(left: string, right: string | null | undefined): boolean {
  if (!right) return false
  return normalizeIdentityKey(left) === normalizeIdentityKey(right)
}

export function VoiceChannelView({ channelId }: { channelId: u64 | null }) {
  const participantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const membersByServer = useMembersStore((s) => s.membersByServer)
  const participants = channelId === null ? EMPTY_PARTICIPANTS : (participantsByChannel[channelId] ?? EMPTY_PARTICIPANTS)

  useEffect(() => {
    if (channelId === null || participants !== EMPTY_PARTICIPANTS) return
    warnOnce(
      `missing_voice_participants_${channelId}`,
      `[zustand-stability] Missing participant array for voice channel ${channelId}; using stable EMPTY_PARTICIPANTS fallback.`,
    )
  }, [channelId, participants])

  const room = useVoiceSessionStore((s) => s.room)
  const joinedChannelId = useVoiceSessionStore((s) => s.joinedChannelId)
  const joining = useVoiceSessionStore((s) => s.joining)
  const error = useVoiceSessionStore((s) => s.error)
  const setRoom = useVoiceSessionStore((s) => s.setRoom)
  const setJoinedChannelId = useVoiceSessionStore((s) => s.setJoinedChannelId)
  const setJoining = useVoiceSessionStore((s) => s.setJoining)
  const setError = useVoiceSessionStore((s) => s.setError)
  const staleCleanupMarker = useRef<string | null>(null)
  const selfIdentity = useConnectionStore((s) => s.identity)

  useEffect(() => {
    setError(null)
  }, [channelId, setError])

  const roomForChannel = channelId !== null && joinedChannelId === channelId ? room : null
  const { activeSpeakerIds, connectionState, remoteParticipants, localParticipant } = useLiveKitRoom(roomForChannel)

  const displayNameByIdentity = useMemo(() => {
    const map = new Map<string, string>()
    for (const serverMembers of Object.values(membersByServer)) {
      for (const member of serverMembers) {
        if (!member.user) continue
        map.set(normalizeIdentityKey(member.userIdentity), member.user.displayName || member.user.username)
      }
    }
    return map
  }, [membersByServer])

  const avatarByIdentity = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const serverMembers of Object.values(membersByServer)) {
      for (const member of serverMembers) {
        map.set(normalizeIdentityKey(member.userIdentity), member.user?.avatarUrl ?? null)
      }
    }
    return map
  }, [membersByServer])

  const livekitParticipantByIdentity = useMemo(() => {
    const map = new Map<string, LocalParticipant | RemoteParticipant>()
    if (localParticipant?.identity) {
      map.set(normalizeIdentityKey(localParticipant.identity), localParticipant)
    }
    for (const participant of remoteParticipants) {
      map.set(normalizeIdentityKey(participant.identity), participant)
    }
    return map
  }, [localParticipant, remoteParticipants])

  const normalizedActiveSpeakers = useMemo(
    () => new Set(Array.from(activeSpeakerIds).map((identity) => normalizeIdentityKey(identity))),
    [activeSpeakerIds],
  )

  const selfParticipant = useMemo(
    () => participants.find((participant) => sameIdentity(participant.userIdentity, selfIdentity)) ?? null,
    [participants, selfIdentity],
  )
  const audioInputId = useMediaDeviceStore((s) => s.audioInputId)
  const videoInputId = useMediaDeviceStore((s) => s.videoInputId)
  const connectedToRoom = roomForChannel !== null && connectionState === ConnectionState.Connected
  const connectingToRoom = joining || (roomForChannel !== null && connectionState === ConnectionState.Connecting)
  const joined = connectedToRoom
  const showLegacyControls = useLegacyCallControlsVisible()
  const displayParticipants = !selfIdentity
    ? participants
    : participants.filter((participant) => joined || !sameIdentity(participant.userIdentity, selfIdentity))
  const muted = selfParticipant?.muted ?? false
  const deafened = selfParticipant?.deafened ?? false
  const sharingCamera = selfParticipant?.sharingCamera ?? false
  const sharingScreen = selfParticipant?.sharingScreen ?? false
  const hasMicCapture = supportsMicrophoneCapture()
  const hasScreenCapture = supportsScreenCapture()

  const patchVoiceState = async (
    patch: Partial<Pick<VoiceParticipant, 'muted' | 'deafened' | 'sharingScreen' | 'sharingCamera'>>,
  ) => {
    if (!selfParticipant || channelId === null) return
    const next = {
      muted: patch.muted ?? selfParticipant.muted,
      deafened: patch.deafened ?? selfParticipant.deafened,
      sharingScreen: patch.sharingScreen ?? selfParticipant.sharingScreen,
      sharingCamera: patch.sharingCamera ?? selfParticipant.sharingCamera,
    }
    await reducers.updateVoiceState(channelId, next.muted, next.deafened, next.sharingScreen, next.sharingCamera)
  }

  const { onToggleMute, onToggleDeafen, onToggleCamera, onToggleScreenShare, onLeave } = useVoiceControlActions({
    room: roomForChannel,
    selfState: selfParticipant
      ? {
          muted: selfParticipant.muted,
          deafened: selfParticipant.deafened,
          sharingCamera: selfParticipant.sharingCamera,
          sharingScreen: selfParticipant.sharingScreen,
        }
      : null,
    audioInputId,
    videoInputId,
    hasScreenCapture,
    setError,
    patchVoiceState,
    onLeaveRoom: async () => {
      if (channelId === null) return
      await leaveLiveKitVoice(channelId, roomForChannel)
      setRoom(null)
      setJoinedChannelId(null)
    },
    leaveErrorMessage: 'Could not leave voice channel.',
  })

  useEffect(() => {
    // Only clean stale presence if we have no local room/session at all.
    // Do not auto-leave while a room exists but is still connecting.
    if (channelId === null || !selfIdentity || joining || roomForChannel !== null || selfParticipant === null) {
      staleCleanupMarker.current = null
      return
    }

    const marker = `${channelId}:${selfParticipant.userIdentity}:${selfParticipant.joinedAt}`
    if (staleCleanupMarker.current === marker) return
    staleCleanupMarker.current = marker
    void reducers.leaveVoiceChannel(channelId).catch(() => undefined)
  }, [channelId, selfIdentity, joining, roomForChannel, selfParticipant])

  useEffect(() => {
    if (!joined) return
    const volume = deafened ? 0 : 1
    for (const participant of remoteParticipants) {
      participant.setVolume(volume)
    }
  }, [joined, deafened, remoteParticipants])

  const statusBadge = connectingToRoom ? 'Joining...' : joined ? 'Joined' : selfParticipant ? 'Syncing...' : 'Not joined'
  const statusVariant = connectingToRoom ? 'outline' : joined ? 'default' : selfParticipant ? 'outline' : 'secondary'
  const channelName = useMemo(() => {
    if (channelId === null) return null
    for (const channels of Object.values(channelsByServer)) {
      const match = channels.find((channel) => channel.id === channelId)
      if (match) return match.name
    }
    return null
  }, [channelId, channelsByServer])
  const ongoingCallDuration = useOngoingCallDuration(selfParticipant?.joinedAt ?? null, joined)

  const mediaTiles = useMemo<VoiceMediaTile[]>(() => {
    return buildVoiceMediaTiles({
      participants: displayParticipants,
      selfIdentity,
      localParticipant,
      livekitParticipantByIdentity,
      normalizedActiveSpeakers,
      displayNameByIdentity,
      avatarByIdentity,
      identityFallbackLength: 12,
    })
  }, [
    avatarByIdentity,
    displayNameByIdentity,
    displayParticipants,
    livekitParticipantByIdentity,
    localParticipant,
    normalizedActiveSpeakers,
    selfIdentity,
  ])

  const onJoin = async () => {
    if (channelId === null) return
    setError(null)
    setJoining(true)
    try {
      if (room && joinedChannelId !== null && joinedChannelId !== channelId) {
        await leaveLiveKitVoice(joinedChannelId, room)
        setRoom(null)
        setJoinedChannelId(null)
      }
      const nextRoom = await joinLiveKitVoice(channelId)
      setRoom(nextRoom)
      setJoinedChannelId(channelId)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not join voice channel.'
      setError(message)
    } finally {
      setJoining(false)
    }
  }

  if (channelId === null) {
    return <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20">Select a voice channel</div>
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{channelName ? `Voice • ${channelName}` : `Voice Channel ${channelId}`}</h2>
          <p className="text-sm text-muted-foreground">
            {participants.length}/15 participants
            {ongoingCallDuration ? ` • Ongoing call since ${ongoingCallDuration}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant}>{statusBadge}</Badge>
          <Button
            size="sm"
            variant={joined ? 'destructive' : 'secondary'}
            disabled={connectingToRoom}
            onClick={() => {
              if (joined) {
                void onLeave()
                return
              }
              void onJoin()
            }}
          >
            {joined ? <PhoneOffIcon className="size-4" /> : <PhoneCallIcon className="size-4" />}
            {connectingToRoom ? 'Joining...' : joined ? 'Leave' : 'Join Voice'}
          </Button>
        </div>
      </header>
      {joined && !hasMicCapture ? (
        <p className="text-xs text-muted-foreground">{getMicrophoneUnavailableReason()}</p>
      ) : null}
      {joined && hasMicCapture && !hasScreenCapture ? (
        <p className="text-xs text-muted-foreground">
          Screen sharing is not available in this runtime.
        </p>
      ) : null}

      <VoiceMediaStage tiles={mediaTiles} className="min-h-0" />

      {showLegacyControls ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          <VoiceControlBar
            joined={joined}
            connecting={connectingToRoom}
            muted={muted}
            deafened={deafened}
            sharingCamera={sharingCamera}
            sharingScreen={sharingScreen}
            hasScreenCapture={hasScreenCapture}
            error={error}
            onJoin={onJoin}
            onToggleMute={async () => {
              await onToggleMute()
            }}
            onToggleDeafen={async () => {
              await onToggleDeafen()
            }}
            onToggleCamera={async () => {
              await onToggleCamera()
            }}
            onToggleScreenShare={async () => {
              await onToggleScreenShare()
            }}
            onLeave={async () => {
              await onLeave()
            }}
          />
        </div>
      ) : null}
    </section>
  )
}
