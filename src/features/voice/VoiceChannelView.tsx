import { useEffect, useRef, useState } from 'react'
import { MicIcon, MicOffIcon, MonitorUpIcon, PhoneOffIcon, VideoIcon, VolumeXIcon } from 'lucide-react'
import {
  getMicrophoneUnavailableReason,
  joinLiveKitVoice,
  leaveLiveKitVoice,
  requestMicrophonePermission,
  supportsMicrophoneCapture,
  supportsScreenCapture,
  useLiveKitRoom,
} from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { useVoiceStore } from '../../stores/voiceStore'
import { useConnectionStore } from '../../stores/connectionStore'
import type { VoiceParticipant, u64 } from '../../types/domain'
import { ConnectionState, type Room } from 'livekit-client'
import { warnOnce } from '../../lib/devWarnings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

const EMPTY_PARTICIPANTS: VoiceParticipant[] = []

export function VoiceChannelView({ channelId }: { channelId: u64 | null }) {
  const participantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const participants = channelId === null ? EMPTY_PARTICIPANTS : (participantsByChannel[channelId] ?? EMPTY_PARTICIPANTS)

  useEffect(() => {
    if (channelId === null || participants !== EMPTY_PARTICIPANTS) return
    warnOnce(
      `missing_voice_participants_${channelId}`,
      `[zustand-stability] Missing participant array for voice channel ${channelId}; using stable EMPTY_PARTICIPANTS fallback.`,
    )
  }, [channelId, participants])

  const [room, setRoom] = useState<Room | null>(null)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const staleCleanupMarker = useRef<string | null>(null)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const { activeSpeakerIds, connectionState, remoteParticipants } = useLiveKitRoom(room)

  if (channelId === null) {
    return <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20">Select a voice channel</div>
  }

  const selfParticipant = participants.find((p) => p.userIdentity === selfIdentity) ?? null
  const joined = room !== null && connectionState === ConnectionState.Connected && selfParticipant !== null
  const displayParticipants =
    joined || !selfIdentity ? participants : participants.filter((participant) => participant.userIdentity !== selfIdentity)
  const muted = selfParticipant?.muted ?? false
  const deafened = selfParticipant?.deafened ?? false
  const sharingCamera = selfParticipant?.sharingCamera ?? false
  const sharingScreen = selfParticipant?.sharingScreen ?? false
  const hasMicCapture = supportsMicrophoneCapture()
  const hasScreenCapture = supportsScreenCapture()

  useEffect(() => {
    if (channelId === null || !selfIdentity || joining) return
    const localDisconnected = room === null || connectionState !== ConnectionState.Connected
    if (!localDisconnected || !selfParticipant) {
      staleCleanupMarker.current = null
      return
    }

    const marker = `${channelId}:${selfParticipant.userIdentity}:${selfParticipant.joinedAt}`
    if (staleCleanupMarker.current === marker) return
    staleCleanupMarker.current = marker
    void reducers.leaveVoiceChannel(channelId).catch(() => undefined)
  }, [channelId, selfIdentity, joining, room, connectionState, selfParticipant])

  useEffect(() => {
    if (!joined) return
    const volume = deafened ? 0 : 1
    for (const participant of remoteParticipants) {
      participant.setVolume(volume)
    }
  }, [joined, deafened, remoteParticipants])

  const patchVoiceState = async (
    patch: Partial<Pick<VoiceParticipant, 'muted' | 'deafened' | 'sharingScreen' | 'sharingCamera'>>,
  ) => {
    if (!selfParticipant) return
    const next = {
      muted: patch.muted ?? selfParticipant.muted,
      deafened: patch.deafened ?? selfParticipant.deafened,
      sharingScreen: patch.sharingScreen ?? selfParticipant.sharingScreen,
      sharingCamera: patch.sharingCamera ?? selfParticipant.sharingCamera,
    }
    await reducers.updateVoiceState(channelId, next.muted, next.deafened, next.sharingScreen, next.sharingCamera)
  }

  const statusBadge = joining ? 'Joining...' : joined ? 'Joined' : 'Not joined'
  const statusVariant = joining ? 'outline' : joined ? 'default' : 'secondary'
  const ensureMicrophoneCapture = async () => {
    if (supportsMicrophoneCapture()) return
    await requestMicrophonePermission()
    if (!supportsMicrophoneCapture()) {
      throw new Error(getMicrophoneUnavailableReason())
    }
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Voice Channel {channelId}</h2>
          <p className="text-sm text-muted-foreground">{displayParticipants.length}/15 participants</p>
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
          {displayParticipants.map((p) => (
            <Card key={p.userIdentity} className="border-border/70 bg-background/60 py-0">
              <CardHeader>
                <CardTitle className="text-sm">{p.userIdentity.slice(0, 12)}</CardTitle>
                <CardDescription>Joined {new Date(p.joinedAt).toLocaleTimeString()}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1">
                {activeSpeakerIds.has(p.userIdentity) ? <Badge>Speaking</Badge> : null}
                {p.muted ? <Badge variant="secondary">Muted</Badge> : null}
                {p.deafened ? <Badge variant="secondary">Deafened</Badge> : null}
                {p.sharingScreen ? <Badge variant="secondary">Screen</Badge> : null}
                {p.sharingCamera ? <Badge variant="secondary">Camera</Badge> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
        {!joined ? (
          <Button
            disabled={joining}
            onClick={async () => {
              setError(null)
              setJoining(true)
              try {
                const r = await joinLiveKitVoice(channelId)
                setRoom(r)
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not join voice channel.'
                setError(message)
              } finally {
                setJoining(false)
              }
            }}
          >
            <MicIcon className="size-4" />
            {joining ? 'Joining...' : 'Join Voice'}
          </Button>
        ) : (
          <>
            <Button
              variant={muted ? 'secondary' : 'outline'}
              onClick={async () => {
                setError(null)
                if (!room || !selfParticipant) return
                try {
                  const nextMuted = !selfParticipant.muted
                  if (!nextMuted) {
                    await ensureMicrophoneCapture()
                  }
                  await room.localParticipant.setMicrophoneEnabled(!nextMuted)
                  await patchVoiceState({ muted: nextMuted })
                } catch (e) {
                  const message = e instanceof Error ? e.message : 'Could not toggle microphone.'
                  setError(message)
                }
              }}
            >
              {muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button
              variant={deafened ? 'secondary' : 'outline'}
              onClick={async () => {
                setError(null)
                if (!selfParticipant) return
                try {
                  await patchVoiceState({ deafened: !selfParticipant.deafened })
                } catch (e) {
                  const message = e instanceof Error ? e.message : 'Could not toggle deafen.'
                  setError(message)
                }
              }}
            >
              <VolumeXIcon className="size-4" />
              {deafened ? 'Undeafen' : 'Deafen'}
            </Button>
            <Button
              variant={sharingCamera ? 'secondary' : 'outline'}
              onClick={async () => {
                setError(null)
                if (!room || !selfParticipant) return
                try {
                  const next = !selfParticipant.sharingCamera
                  if (next) {
                    await ensureMicrophoneCapture()
                  }
                  await room.localParticipant.setCameraEnabled(next)
                  await patchVoiceState({ sharingCamera: next })
                } catch (e) {
                  const message = e instanceof Error ? e.message : 'Could not toggle camera.'
                  setError(message)
                }
              }}
            >
              <VideoIcon className="size-4" />
              {sharingCamera ? 'Stop Camera' : 'Camera'}
            </Button>
            <Button
              variant={sharingScreen ? 'secondary' : 'outline'}
              disabled={!hasScreenCapture}
              onClick={async () => {
                setError(null)
                if (!room || !selfParticipant) return
                if (!hasScreenCapture) {
                  setError('Screen sharing APIs are unavailable in this runtime.')
                  return
                }
                try {
                  const next = !selfParticipant.sharingScreen
                  await room.localParticipant.setScreenShareEnabled(next)
                  await patchVoiceState({ sharingScreen: next })
                } catch (e) {
                  const message = e instanceof Error ? e.message : 'Could not toggle screen share.'
                  setError(message)
                }
              }}
            >
              <MonitorUpIcon className="size-4" />
              {sharingScreen ? 'Stop Share' : 'Share Screen'}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setError(null)
                try {
                  await leaveLiveKitVoice(channelId, room)
                  setRoom(null)
                } catch (e) {
                  const message = e instanceof Error ? e.message : 'Could not leave voice channel.'
                  setError(message)
                }
              }}
            >
              <PhoneOffIcon className="size-4" />
              Leave
            </Button>
          </>
        )}
        {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
      </div>
    </section>
  )
}
