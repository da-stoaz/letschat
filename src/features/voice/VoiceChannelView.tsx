import { Fragment, useEffect, useMemo, useRef } from 'react'
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
import { useVoiceStore } from '../../stores/voiceStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMembersStore } from '../../stores/membersStore'
import { useVoiceSessionStore } from '../../stores/voiceSessionStore'
import type { VoiceParticipant, u64 } from '../../types/domain'
import { ConnectionState } from 'livekit-client'
import { warnOnce } from '../../lib/devWarnings'
import { VoiceControlBar } from './components/VoiceControlBar'
import { ParticipantMediaTile } from './components/ParticipantMediaTile'
import { useLegacyCallControlsVisible } from './hooks/useLegacyCallControls'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

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
  if (channelId === null) {
    return <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20">Select a voice channel</div>
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Voice Channel {channelId}</h2>
          <p className="text-sm text-muted-foreground">{participants.length}/15 participants</p>
        </div>
        <Badge variant={statusVariant}>{statusBadge}</Badge>
      </header>
      {joined && !hasMicCapture ? (
        <p className="text-xs text-muted-foreground">{getMicrophoneUnavailableReason()}</p>
      ) : null}
      {joined && hasMicCapture && !hasScreenCapture ? (
        <p className="text-xs text-muted-foreground">
          Screen sharing is not available in this runtime.
        </p>
      ) : null}

      <ScrollArea className="min-h-0">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {displayParticipants.map((p) => {
            const local = sameIdentity(p.userIdentity, selfIdentity)
            const participantIdentityKey = normalizeIdentityKey(p.userIdentity)
            const mediaParticipant = local ? localParticipant : livekitParticipantByIdentity.get(participantIdentityKey) ?? null
            return (
              <Fragment key={p.userIdentity}>
                <ParticipantMediaTile
                  displayName={displayNameByIdentity.get(participantIdentityKey) ?? p.userIdentity.slice(0, 12)}
                  avatarUrl={avatarByIdentity.get(participantIdentityKey) ?? null}
                  joinedAt={p.joinedAt}
                  participant={mediaParticipant}
                  tileType="profile"
                  isLocal={local}
                  isSpeaking={normalizedActiveSpeakers.has(participantIdentityKey)}
                  muted={p.muted}
                  deafened={p.deafened}
                  sharingScreen={p.sharingScreen}
                  sharingCamera={p.sharingCamera}
                />
                {p.sharingScreen ? (
                  <ParticipantMediaTile
                    displayName={displayNameByIdentity.get(participantIdentityKey) ?? p.userIdentity.slice(0, 12)}
                    avatarUrl={avatarByIdentity.get(participantIdentityKey) ?? null}
                    joinedAt={p.joinedAt}
                    participant={mediaParticipant}
                    tileType="screen"
                    isLocal={local}
                    isSpeaking={normalizedActiveSpeakers.has(participantIdentityKey)}
                    muted={p.muted}
                    deafened={p.deafened}
                    sharingScreen={p.sharingScreen}
                    sharingCamera={p.sharingCamera}
                  />
                ) : null}
              </Fragment>
            )
          })}
        </div>
      </ScrollArea>

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
            onJoin={async () => {
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
            }}
            onToggleMute={async () => {
              return
            }}
            onToggleDeafen={async () => {
              return
            }}
            onToggleCamera={async () => {
              return
            }}
            onToggleScreenShare={async () => {
              return
            }}
            onLeave={async () => {
              return
            }}
          />
        </div>
      ) : null}
    </section>
  )
}
