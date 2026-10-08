import { useEffect, useMemo } from 'react'
import { ConnectionState, type LocalParticipant, type RemoteParticipant } from 'livekit-client'
import {
  dmVoiceRoomKey,
  getMicrophoneUnavailableReason,
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
import { VoiceMediaStage, type VoiceMediaTile } from '../voice/components/VoiceMediaStage'
import { CallLatencyBadge } from '../voice/components/CallLatencyBadge'
import { useInlineCallControlsVisible } from '../voice/hooks/useInlineCallControls'
import { useVoiceControlActions } from '../voice/hooks/useVoiceControlActions'
import { buildVoiceMediaTiles } from '../voice/mediaTiles'
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
  const answered = useDmVoiceSessionStore((s) => s.answered)
  const setAnswered = useDmVoiceSessionStore((s) => s.setAnswered)
  const setError = useDmVoiceSessionStore((s) => s.setError)
  const audioInputId = useMediaDeviceStore((s) => s.audioInputId)
  const videoInputId = useMediaDeviceStore((s) => s.videoInputId)
  const showInlineControls = useInlineCallControlsVisible()

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
  const connecting = (joining && sameIdentity(partnerIdentity, joinedPartnerIdentity)) || (roomForPartner !== null && connectionState === ConnectionState.Connecting)
  const muted = selfParticipant?.muted ?? false
  const deafened = selfParticipant?.deafened ?? false
  const sharingCamera = selfParticipant?.sharingCamera ?? false
  const sharingScreen = selfParticipant?.sharingScreen ?? false
  const hasMicCapture = supportsMicrophoneCapture()
  const hasScreenCapture = supportsScreenCapture()


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
  const mediaTiles = useMemo<VoiceMediaTile[]>(() => {
    return buildVoiceMediaTiles({
      participants,
      selfIdentity,
      localParticipant,
      livekitParticipantByIdentity,
      normalizedActiveSpeakers,
      displayNameByIdentity,
      avatarByIdentity,
      identityFallbackLength: 10,
    })
  }, [
    avatarByIdentity,
    displayNameByIdentity,
    livekitParticipantByIdentity,
    localParticipant,
    normalizedActiveSpeakers,
    participants,
    selfIdentity,
  ])

  return (
    <Card
      className={
        showHeader
          ? 'border-border/70 bg-background/40 py-0'
          : 'border-0 bg-transparent py-0 shadow-none'
      }
    >
      {showHeader ? (
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">DM Voice Call</CardTitle>
          <div className="flex items-center gap-2">
            {joined ? <CallLatencyBadge room={roomForPartner} compact /> : null}
            <Badge variant={statusVariant}>{statusBadge}</Badge>
          </div>
        </CardHeader>
      ) : null}
      <CardContent className={showHeader ? 'space-y-2' : 'space-y-2 px-0'}>
        <VoiceMediaStage
          tiles={mediaTiles}
          className="min-h-[260px]"
          emptyStateText="No participants are sharing media in this call."
        />

        {showInlineControls && joined ? (
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
