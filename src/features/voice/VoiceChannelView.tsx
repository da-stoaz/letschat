import { useEffect, useRef, useState } from 'react'
import { MicIcon, MicOffIcon, MonitorUpIcon, PhoneOffIcon, VideoIcon, VolumeXIcon } from 'lucide-react'
import { joinLiveKitVoice, leaveLiveKitVoice, useLiveKitRoom } from '../../lib/livekit'
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
  const { activeSpeakerIds, connectionState } = useLiveKitRoom(room)

  if (channelId === null) {
    return <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20">Select a voice channel</div>
  }

  const selfParticipant = participants.find((p) => p.userIdentity === selfIdentity) ?? null
  const joined = room !== null && connectionState === ConnectionState.Connected && selfParticipant !== null
  const displayParticipants =
    joined || !selfIdentity ? participants : participants.filter((participant) => participant.userIdentity !== selfIdentity)

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

  const statusBadge = joining ? 'Joining...' : joined ? 'Joined' : 'Not joined'
  const statusVariant = joining ? 'outline' : joined ? 'default' : 'secondary'

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Voice Channel {channelId}</h2>
          <p className="text-sm text-muted-foreground">{displayParticipants.length}/15 participants</p>
        </div>
        <Badge variant={statusVariant}>{statusBadge}</Badge>
      </header>

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
            <Button variant="outline" onClick={() => reducers.updateVoiceState(channelId, true, false, false, false)}>
              <MicOffIcon className="size-4" />
              Mute
            </Button>
            <Button variant="outline" onClick={() => reducers.updateVoiceState(channelId, false, true, false, false)}>
              <VolumeXIcon className="size-4" />
              Deafen
            </Button>
            <Button variant="outline" onClick={() => reducers.updateVoiceState(channelId, false, false, false, true)}>
              <VideoIcon className="size-4" />
              Camera
            </Button>
            <Button variant="outline" onClick={() => reducers.updateVoiceState(channelId, false, false, true, false)}>
              <MonitorUpIcon className="size-4" />
              Share Screen
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
