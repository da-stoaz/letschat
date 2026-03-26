import { useEffect, useMemo, useRef } from 'react'
import { ConnectionState } from 'livekit-client'
import {
  dmVoiceRoomKey,
  getMicrophoneUnavailableReason,
  joinLiveKitDmVoice,
  leaveLiveKitDmVoice,
  requestMicrophonePermission,
  supportsMicrophoneCapture,
  supportsScreenCapture,
  useLiveKitRoom,
} from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { useConnectionStore } from '../../stores/connectionStore'
import { useDmVoiceSessionStore } from '../../stores/dmVoiceSessionStore'
import { useDmVoiceStore } from '../../stores/dmVoiceStore'
import { useUsersStore } from '../../stores/usersStore'
import type { DmVoiceParticipant, Identity } from '../../types/domain'
import { VoiceControlBar } from '../voice/components/VoiceControlBar'
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

export function DmVoicePanel({ partnerIdentity }: { partnerIdentity: Identity }) {
  const selfIdentity = useConnectionStore((s) => s.identity)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
  const participantsByRoom = useDmVoiceStore((s) => s.participantsByRoom)
  const room = useDmVoiceSessionStore((s) => s.room)
  const joinedPartnerIdentity = useDmVoiceSessionStore((s) => s.joinedPartnerIdentity)
  const joining = useDmVoiceSessionStore((s) => s.joining)
  const error = useDmVoiceSessionStore((s) => s.error)
  const setRoom = useDmVoiceSessionStore((s) => s.setRoom)
  const setJoinedPartnerIdentity = useDmVoiceSessionStore((s) => s.setJoinedPartnerIdentity)
  const setJoining = useDmVoiceSessionStore((s) => s.setJoining)
  const setError = useDmVoiceSessionStore((s) => s.setError)
  const staleCleanupMarker = useRef<string | null>(null)

  const roomKey = selfIdentity ? dmVoiceRoomKey(selfIdentity, partnerIdentity) : null
  const participants = roomKey ? (participantsByRoom[roomKey] ?? EMPTY_PARTICIPANTS) : EMPTY_PARTICIPANTS

  useEffect(() => {
    setError(null)
  }, [partnerIdentity, setError])

  const roomForPartner =
    room !== null && joinedPartnerIdentity !== null && sameIdentity(joinedPartnerIdentity, partnerIdentity) ? room : null
  const { activeSpeakerIds, connectionState, remoteParticipants } = useLiveKitRoom(roomForPartner)
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

  const joined = roomForPartner !== null && connectionState === ConnectionState.Connected
  const connecting = joining || (roomForPartner !== null && connectionState === ConnectionState.Connecting)
  const muted = selfParticipant?.muted ?? false
  const deafened = selfParticipant?.deafened ?? false
  const sharingCamera = selfParticipant?.sharingCamera ?? false
  const sharingScreen = selfParticipant?.sharingScreen ?? false
  const hasMicCapture = supportsMicrophoneCapture()
  const hasScreenCapture = supportsScreenCapture()

  useEffect(() => {
    if (joining || !selfParticipant) {
      staleCleanupMarker.current = null
      return
    }
    const localDisconnected = roomForPartner === null || connectionState !== ConnectionState.Connected
    if (!localDisconnected) {
      staleCleanupMarker.current = null
      return
    }

    const marker = `${partnerIdentity}:${selfParticipant.userIdentity}:${selfParticipant.joinedAt}`
    if (staleCleanupMarker.current === marker) return
    staleCleanupMarker.current = marker
    void reducers.leaveDmVoice(partnerIdentity).catch(() => undefined)
  }, [connectionState, joining, partnerIdentity, roomForPartner, selfParticipant])

  useEffect(() => {
    if (!joined) return
    const volume = deafened ? 0 : 1
    for (const participant of remoteParticipants) {
      participant.setVolume(volume)
    }
  }, [deafened, joined, remoteParticipants])

  const ensureMicrophoneCapture = async () => {
    if (supportsMicrophoneCapture()) return
    await requestMicrophonePermission()
    if (!supportsMicrophoneCapture()) {
      throw new Error(getMicrophoneUnavailableReason())
    }
  }

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

  const statusBadge = connecting ? 'Joining...' : joined ? 'Joined' : selfParticipant ? 'Syncing...' : 'Not joined'
  const statusVariant = connecting ? 'outline' : joined ? 'default' : selfParticipant ? 'outline' : 'secondary'

  return (
    <Card className="border-border/70 bg-background/40 py-0">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">DM Voice Call</CardTitle>
        <Badge variant={statusVariant}>{statusBadge}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {participants.map((participant) => (
            <Badge key={`${participant.roomKey}:${participant.userIdentity}`} variant="secondary">
              {displayNameByIdentity.get(normalizeIdentityKey(participant.userIdentity)) ??
                participant.userIdentity.slice(0, 10)}
              {activeSpeakerIds.has(participant.userIdentity) ? ' • Speaking' : ''}
            </Badge>
          ))}
          {participants.length === 0 ? <Badge variant="outline">No one in call</Badge> : null}
        </div>

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
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not join DM voice call.'
                setError(message)
              } finally {
                setJoining(false)
              }
            }}
            onToggleMute={async () => {
              setError(null)
              if (!roomForPartner || !selfParticipant) return
              try {
                const nextMuted = !selfParticipant.muted
                if (!nextMuted) {
                  await ensureMicrophoneCapture()
                }
                await roomForPartner.localParticipant.setMicrophoneEnabled(!nextMuted)
                await patchVoiceState({ muted: nextMuted })
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not toggle microphone.'
                setError(message)
              }
            }}
            onToggleDeafen={async () => {
              setError(null)
              if (!selfParticipant) return
              try {
                await patchVoiceState({ deafened: !selfParticipant.deafened })
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not toggle deafen.'
                setError(message)
              }
            }}
            onToggleCamera={async () => {
              setError(null)
              if (!roomForPartner || !selfParticipant) return
              try {
                const next = !selfParticipant.sharingCamera
                if (next) {
                  await ensureMicrophoneCapture()
                }
                await roomForPartner.localParticipant.setCameraEnabled(next)
                await patchVoiceState({ sharingCamera: next })
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not toggle camera.'
                setError(message)
              }
            }}
            onToggleScreenShare={async () => {
              setError(null)
              if (!roomForPartner || !selfParticipant) return
              if (!hasScreenCapture) {
                setError('Screen sharing APIs are unavailable in this runtime.')
                return
              }
              try {
                const next = !selfParticipant.sharingScreen
                await roomForPartner.localParticipant.setScreenShareEnabled(next)
                await patchVoiceState({ sharingScreen: next })
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not toggle screen share.'
                setError(message)
              }
            }}
            onLeave={async () => {
              setError(null)
              try {
                await leaveLiveKitDmVoice(partnerIdentity, roomForPartner)
                setRoom(null)
                setJoinedPartnerIdentity(null)
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not leave DM voice call.'
                setError(message)
              }
            }}
          />
        </div>

        {joined && !hasMicCapture ? <p className="text-xs text-muted-foreground">{getMicrophoneUnavailableReason()}</p> : null}
        {joined && hasMicCapture && !hasScreenCapture ? (
          <p className="text-xs text-muted-foreground">Screen sharing is not available in this runtime.</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
