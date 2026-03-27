import { Fragment, useEffect, useMemo, useRef } from 'react'
import { ConnectionState, Track, type LocalParticipant, type RemoteParticipant } from 'livekit-client'
import {
  dmVoiceRoomKey,
  getMicrophoneUnavailableReason,
  joinLiveKitDmVoice,
  leaveLiveKitDmVoice,
  supportsMicrophoneCapture,
  supportsScreenCapture,
  useLiveKitRoom,
} from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { encodeDmSystemMessage, getCallDurationSeconds } from './systemMessages'
import { useConnectionStore } from '../../stores/connectionStore'
import { useDmVoiceSessionStore } from '../../stores/dmVoiceSessionStore'
import { useDmVoiceStore } from '../../stores/dmVoiceStore'
import { useMediaDeviceStore } from '../../stores/mediaDeviceStore'
import { useUsersStore } from '../../stores/usersStore'
import type { DmVoiceParticipant, Identity } from '../../types/domain'
import { VoiceControlBar } from '../voice/components/VoiceControlBar'
import { ParticipantMediaTile } from '../voice/components/ParticipantMediaTile'
import { useLegacyCallControlsVisible } from '../voice/hooks/useLegacyCallControls'
import { useVoiceControlActions } from '../voice/hooks/useVoiceControlActions'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const EMPTY_PARTICIPANTS: DmVoiceParticipant[] = []

function normalizeIdentityKey(value: string): string {
  return value.trim().toLowerCase()
}

function sameIdentity(left: string, right: string | null | undefined): boolean {
  if (!right) return false
  return normalizeIdentityKey(left) === normalizeIdentityKey(right)
}

export function DmVoicePanel({
  partnerIdentity,
  showHeader = true,
}: {
  partnerIdentity: Identity
  showHeader?: boolean
}) {
  const selfIdentity = useConnectionStore((s) => s.identity)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
  const participantsByRoom = useDmVoiceStore((s) => s.participantsByRoom)
  const room = useDmVoiceSessionStore((s) => s.room)
  const joinedPartnerIdentity = useDmVoiceSessionStore((s) => s.joinedPartnerIdentity)
  const joining = useDmVoiceSessionStore((s) => s.joining)
  const error = useDmVoiceSessionStore((s) => s.error)
  const setRoom = useDmVoiceSessionStore((s) => s.setRoom)
  const setJoinedPartnerIdentity = useDmVoiceSessionStore((s) => s.setJoinedPartnerIdentity)
  const answered = useDmVoiceSessionStore((s) => s.answered)
  const setJoining = useDmVoiceSessionStore((s) => s.setJoining)
  const setAnswered = useDmVoiceSessionStore((s) => s.setAnswered)
  const setError = useDmVoiceSessionStore((s) => s.setError)
  const audioInputId = useMediaDeviceStore((s) => s.audioInputId)
  const videoInputId = useMediaDeviceStore((s) => s.videoInputId)
  const staleCleanupMarker = useRef<string | null>(null)
  const showLegacyControls = useLegacyCallControlsVisible()

  const roomKey = selfIdentity ? dmVoiceRoomKey(selfIdentity, partnerIdentity) : null
  const participants = roomKey ? (participantsByRoom[roomKey] ?? EMPTY_PARTICIPANTS) : EMPTY_PARTICIPANTS

  useEffect(() => {
    setError(null)
  }, [partnerIdentity, setError])

  const roomForPartner =
    room !== null && joinedPartnerIdentity !== null && sameIdentity(joinedPartnerIdentity, partnerIdentity) ? room : null
  const { activeSpeakerIds, connectionState, remoteParticipants, localParticipant } = useLiveKitRoom(roomForPartner)
  const selfParticipant = useMemo(
    () => participants.find((participant) => sameIdentity(participant.userIdentity, selfIdentity)) ?? null,
    [participants, selfIdentity],
  )

  const displayNameByIdentity = useMemo(() => {
    const map = new Map<string, string>()
    for (const user of Object.values(usersByIdentity)) {
      map.set(normalizeIdentityKey(user.identity), user.displayName || user.username)
    }
    return map
  }, [usersByIdentity])

  const avatarByIdentity = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const user of Object.values(usersByIdentity)) {
      map.set(normalizeIdentityKey(user.identity), user.avatarUrl ?? null)
    }
    return map
  }, [usersByIdentity])

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

  const joined = roomForPartner !== null && connectionState === ConnectionState.Connected
  const connecting = joining || (roomForPartner !== null && connectionState === ConnectionState.Connecting)
  const muted = selfParticipant?.muted ?? false
  const deafened = selfParticipant?.deafened ?? false
  const sharingCamera = selfParticipant?.sharingCamera ?? false
  const sharingScreen = selfParticipant?.sharingScreen ?? false
  const hasMicCapture = supportsMicrophoneCapture()
  const hasScreenCapture = supportsScreenCapture()

  useEffect(() => {
    // Only clean stale presence if we have no local room/session at all.
    // Do not auto-leave while a room exists but is still connecting.
    if (joining || roomForPartner !== null || !selfParticipant) {
      staleCleanupMarker.current = null
      return
    }

    const marker = `${partnerIdentity}:${selfParticipant.userIdentity}:${selfParticipant.joinedAt}`
    if (staleCleanupMarker.current === marker) return
    staleCleanupMarker.current = marker
    void reducers.leaveDmVoice(partnerIdentity).catch(() => undefined)
  }, [joining, partnerIdentity, roomForPartner, selfParticipant])

  useEffect(() => {
    if (!joined) return
    const volume = deafened ? 0 : 1
    for (const participant of remoteParticipants) {
      participant.setVolume(volume)
    }
  }, [deafened, joined, remoteParticipants])

  useEffect(() => {
    if (!joined) return
    if (remoteParticipants.length === 0) return
    setAnswered(true)
  }, [joined, remoteParticipants.length, setAnswered])

  const patchVoiceState = async (
    patch: Partial<Pick<DmVoiceParticipant, 'muted' | 'deafened' | 'sharingScreen' | 'sharingCamera'>>,
  ) => {
    if (!selfParticipant) return
    const next = {
      muted: patch.muted ?? selfParticipant.muted,
      deafened: patch.deafened ?? selfParticipant.deafened,
      sharingScreen: patch.sharingScreen ?? selfParticipant.sharingScreen,
      sharingCamera: patch.sharingCamera ?? selfParticipant.sharingCamera,
    }
    await reducers.updateDmVoiceState(
      partnerIdentity,
      next.muted,
      next.deafened,
      next.sharingScreen,
      next.sharingCamera,
    )
  }

  const { onToggleMute, onToggleDeafen, onToggleCamera, onToggleScreenShare, onLeave } = useVoiceControlActions({
    room: roomForPartner,
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
      const callDurationSeconds = getCallDurationSeconds(selfParticipant?.joinedAt)
      await leaveLiveKitDmVoice(partnerIdentity, roomForPartner)
      setRoom(null)
      setJoinedPartnerIdentity(null)
      setAnswered(false)
      if (callDurationSeconds !== null) {
        await reducers
          .sendDirectMessage(
            partnerIdentity,
            encodeDmSystemMessage('call_ended', {
              durationSeconds: callDurationSeconds,
              missed: !answered,
            }),
          )
          .catch(() => undefined)
      }
    },
    leaveErrorMessage: 'Could not leave DM voice call.',
  })

  const statusBadge = connecting ? 'Joining...' : joined ? 'Joined' : selfParticipant ? 'Syncing...' : 'Not joined'
  const statusVariant = connecting ? 'outline' : joined ? 'default' : selfParticipant ? 'outline' : 'secondary'

  return (
    <Card className="border-border/70 bg-background/40 py-0">
      {showHeader ? (
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">DM Voice Call</CardTitle>
          <Badge variant={statusVariant}>{statusBadge}</Badge>
        </CardHeader>
      ) : null}
      <CardContent className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-2">
          {participants.map((participant) => {
            const participantIdentityKey = normalizeIdentityKey(participant.userIdentity)
            const local = sameIdentity(participant.userIdentity, selfIdentity)
            const mediaParticipant = local
              ? localParticipant
              : livekitParticipantByIdentity.get(participantIdentityKey) ?? null
            const participantIsActiveSpeaker = normalizedActiveSpeakers.has(participantIdentityKey)
            const hasMicrophoneTrack = Boolean(
              mediaParticipant?.getTrackPublication(Track.Source.Microphone)?.audioTrack,
            )
            const hasScreenAudioTrack = Boolean(
              mediaParticipant?.getTrackPublication(Track.Source.ScreenShareAudio)?.audioTrack,
            )
            const micSpeaking = participantIsActiveSpeaker && hasMicrophoneTrack
            const screenAudioActive = participantIsActiveSpeaker && hasScreenAudioTrack
            return (
              <Fragment key={`${participant.roomKey}:${participant.userIdentity}`}>
                <ParticipantMediaTile
                  displayName={
                    displayNameByIdentity.get(participantIdentityKey) ??
                    participant.userIdentity.slice(0, 10)
                  }
                  avatarUrl={avatarByIdentity.get(participantIdentityKey) ?? null}
                  joinedAt={participant.joinedAt}
                  participant={mediaParticipant}
                  tileType="profile"
                  isLocal={local}
                  isSpeaking={micSpeaking}
                  isScreenAudioActive={false}
                  muted={participant.muted}
                  deafened={participant.deafened}
                  sharingScreen={participant.sharingScreen}
                  sharingCamera={participant.sharingCamera}
                />
                {participant.sharingScreen ? (
                  <ParticipantMediaTile
                    displayName={
                      displayNameByIdentity.get(participantIdentityKey) ??
                      participant.userIdentity.slice(0, 10)
                    }
                    avatarUrl={avatarByIdentity.get(participantIdentityKey) ?? null}
                    joinedAt={participant.joinedAt}
                    participant={mediaParticipant}
                    tileType="screen"
                    isLocal={local}
                    isSpeaking={false}
                    isScreenAudioActive={screenAudioActive}
                    muted={participant.muted}
                    deafened={participant.deafened}
                    sharingScreen={participant.sharingScreen}
                    sharingCamera={participant.sharingCamera}
                  />
                ) : null}
              </Fragment>
            )
          })}
        </div>

        {showLegacyControls && joined ? (
          <div className="flex flex-wrap items-center gap-2">
            <VoiceControlBar
              joined={joined}
              connecting={connecting}
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
                  const shouldEmitCallStarted = participants.length === 0
                  const existingRoom = useDmVoiceSessionStore.getState().room
                  const existingPartner = useDmVoiceSessionStore.getState().joinedPartnerIdentity
                  if (existingRoom && existingPartner && !sameIdentity(existingPartner, partnerIdentity)) {
                    await leaveLiveKitDmVoice(existingPartner, existingRoom)
                    setRoom(null)
                    setJoinedPartnerIdentity(null)
                  }

                  const nextRoom = await joinLiveKitDmVoice(partnerIdentity)
                  setRoom(nextRoom)
                  setJoinedPartnerIdentity(partnerIdentity)
                  setAnswered(false)
                  if (shouldEmitCallStarted) {
                    await reducers
                      .sendDirectMessage(partnerIdentity, encodeDmSystemMessage('call_started'))
                      .catch(() => undefined)
                  }
                } catch (e) {
                  const message = e instanceof Error ? e.message : 'Could not join DM voice call.'
                  setError(message)
                } finally {
                  setJoining(false)
                }
              }}
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

        {joined && !hasMicCapture ? <p className="text-xs text-muted-foreground">{getMicrophoneUnavailableReason()}</p> : null}
        {joined && hasMicCapture && !hasScreenCapture ? (
          <p className="text-xs text-muted-foreground">Screen sharing is not available in this runtime.</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
