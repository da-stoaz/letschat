import { useEffect, useRef } from 'react'
import { Track, type LocalParticipant, type RemoteParticipant, type TrackPublication } from 'livekit-client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

type MediaParticipant = LocalParticipant | RemoteParticipant

interface ParticipantMediaTileProps {
  displayName: string
  avatarUrl?: string | null
  joinedAt?: string
  participant: MediaParticipant | null
  isLocal: boolean
  isSpeaking: boolean
  muted: boolean
  deafened: boolean
  sharingScreen: boolean
  sharingCamera: boolean
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function pickVideoPublication(
  publications: Map<string, TrackPublication>,
): TrackPublication | null {
  for (const publication of publications.values()) {
    if (!publication.videoTrack) continue
    if (publication.source === Track.Source.ScreenShare || publication.source === Track.Source.Camera) continue
    return publication
  }
  return null
}

function pickAudioPublication(
  publications: Map<string, TrackPublication>,
): TrackPublication | null {
  const withTracks = Array.from(publications.values()).filter((publication) => Boolean(publication.track))
  if (withTracks.length === 0) return null
  return withTracks[0]
}

export function ParticipantMediaTile({
  displayName,
  avatarUrl = null,
  joinedAt,
  participant,
  isLocal,
  isSpeaking,
  muted,
  deafened,
  sharingScreen,
  sharingCamera,
}: ParticipantMediaTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pipVideoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const screenTrack = participant?.getTrackPublication(Track.Source.ScreenShare)?.videoTrack ?? null
  const cameraTrack = participant?.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null
  const fallbackVideoTrack = participant ? pickVideoPublication(participant.videoTrackPublications)?.videoTrack ?? null : null
  const primaryVideoTrack = screenTrack ?? cameraTrack ?? fallbackVideoTrack
  const pipVideoTrack = screenTrack && cameraTrack ? cameraTrack : null

  const audioTrack = participant ? pickAudioPublication(participant.audioTrackPublications)?.track ?? null : null

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return

    if (!primaryVideoTrack || primaryVideoTrack.kind !== Track.Kind.Video) {
      videoElement.srcObject = null
      return
    }

    primaryVideoTrack.attach(videoElement)
    videoElement.muted = true
    void videoElement.play().catch(() => undefined)

    return () => {
      primaryVideoTrack.detach(videoElement)
      videoElement.srcObject = null
    }
  }, [primaryVideoTrack])

  useEffect(() => {
    const videoElement = pipVideoRef.current
    if (!videoElement) return

    if (!pipVideoTrack || pipVideoTrack.kind !== Track.Kind.Video) {
      videoElement.srcObject = null
      return
    }

    pipVideoTrack.attach(videoElement)
    videoElement.muted = true
    void videoElement.play().catch(() => undefined)

    return () => {
      pipVideoTrack.detach(videoElement)
      videoElement.srcObject = null
    }
  }, [pipVideoTrack])

  useEffect(() => {
    const audioElement = audioRef.current
    if (!audioElement) return

    if (isLocal || !audioTrack || audioTrack.kind !== Track.Kind.Audio) {
      audioElement.srcObject = null
      return
    }

    audioTrack.attach(audioElement)
    audioElement.muted = false
    void audioElement.play().catch(() => undefined)

    return () => {
      audioTrack.detach(audioElement)
      audioElement.srcObject = null
    }
  }, [audioTrack, isLocal])

  const showVideo = Boolean(primaryVideoTrack && primaryVideoTrack.kind === Track.Kind.Video)

  return (
    <Card className="border-border/70 bg-background/60 py-0">
      <CardHeader>
        <CardTitle className="text-sm">{displayName}</CardTitle>
        <CardDescription>{joinedAt ? `Joined ${new Date(joinedAt).toLocaleTimeString()}` : isLocal ? 'You' : 'Participant'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div
          className={`relative aspect-video overflow-hidden rounded-lg border border-border/70 bg-muted/30 ${
            isSpeaking ? 'ring-2 ring-emerald-400/80' : ''
          }`}
        >
          {showVideo ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Avatar size="lg">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
                <AvatarFallback>{initials(displayName)}</AvatarFallback>
              </Avatar>
            </div>
          )}
          {pipVideoTrack ? (
            <div className="absolute bottom-2 right-2 h-20 w-32 overflow-hidden rounded-md border border-border/60 bg-black/60">
              <video
                ref={pipVideoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}
          {!isLocal ? <audio ref={audioRef} autoPlay /> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {isSpeaking ? <Badge>Speaking</Badge> : null}
          {isLocal ? <Badge variant="outline">You</Badge> : null}
          {muted ? <Badge variant="secondary">Muted</Badge> : null}
          {deafened ? <Badge variant="secondary">Deafened</Badge> : null}
          {sharingScreen ? <Badge variant="secondary">Screen</Badge> : null}
          {sharingCamera ? <Badge variant="secondary">Camera</Badge> : null}
        </div>
      </CardContent>
    </Card>
  )
}
