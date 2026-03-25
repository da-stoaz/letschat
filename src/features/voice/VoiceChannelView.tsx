import { useEffect, useState } from 'react'
import { MicIcon, MicOffIcon, MonitorUpIcon, PhoneOffIcon, VideoIcon, VolumeXIcon } from 'lucide-react'
import { joinLiveKitVoice, leaveLiveKitVoice } from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { useVoiceStore } from '../../stores/voiceStore'
import type { VoiceParticipant, u64 } from '../../types/domain'
import type { Room } from 'livekit-client'
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
  const [error, setError] = useState<string | null>(null)

  if (channelId === null) {
    return <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20">Select a voice channel</div>
  }

  const joined = room !== null

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Voice Channel {channelId}</h2>
          <p className="text-sm text-muted-foreground">{participants.length}/15 participants</p>
        </div>
        {joined ? <Badge>Connected</Badge> : <Badge variant="secondary">Not joined</Badge>}
      </header>

      <ScrollArea className="min-h-0">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {participants.map((p) => (
            <Card key={p.userIdentity} className="border-border/70 bg-background/60 py-0">
              <CardHeader>
                <CardTitle className="text-sm">{p.userIdentity.slice(0, 12)}</CardTitle>
                <CardDescription>Joined {new Date(p.joinedAt).toLocaleTimeString()}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1">
                {p.muted ? <Badge variant="secondary">Muted</Badge> : null}
                {p.deafened ? <Badge variant="secondary">Deafened</Badge> : null}
                {p.sharingScreen ? <Badge variant="secondary">Screen</Badge> : null}
                {p.sharingCamera ? <Badge variant="secondary">Camera</Badge> : null}
                {!p.muted && !p.deafened && !p.sharingScreen && !p.sharingCamera ? (
                  <Badge variant="outline">Active</Badge>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
        {!joined ? (
          <Button
            onClick={async () => {
              setError(null)
              try {
                const r = await joinLiveKitVoice(channelId)
                setRoom(r)
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not join voice channel.'
                setError(message)
              }
            }}
          >
            <MicIcon className="size-4" />
            Join Voice
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
