import { useEffect, useRef } from 'react'
import { Track, type LocalParticipant, type RemoteParticipant, type TrackPublication } from 'livekit-client'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '../../../lib/utils'
import { MonitorUpIcon, VideoOffIcon } from 'lucide-react'

type MediaParticipant = LocalParticipant | RemoteParticipant

interface ParticipantMediaTileProps {
  displayName: string
  avatarUrl?: string | null
  joinedAt?: string
  participant: MediaParticipant | null
  tileType?: 'profile' | 'screen'
  isLocal: boolean
  isSpeaking: boolean
  isScreenAudioActive?: boolean
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
  tileType = 'profile',
  isLocal,
  isSpeaking,
  isScreenAudioActive = false,
  muted,
  deafened,
  sharingScreen,
  sharingCamera,
}: ParticipantMediaTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const screenTrack = participant?.getTrackPublication(Track.Source.ScreenShare)?.videoTrack ?? null
  const cameraTrack = participant?.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null
  const fallbackVideoTrack = participant ? pickVideoPublication(participant.videoTrackPublications)?.videoTrack ?? null : null
  const primaryVideoTrack =
    tileType === 'screen' ? screenTrack : cameraTrack ?? fallbackVideoTrack

  const microphoneAudioTrack =
    participant?.getTrackPublication(Track.Source.Microphone)?.audioTrack ?? null
  const screenShareAudioTrack =
    participant?.getTrackPublication(Track.Source.ScreenShareAudio)?.audioTrack ?? null
  const fallbackAudioTrack = participant ? pickAudioPublication(participant.audioTrackPublications)?.track ?? null : null
  const audioTrack =
    tileType === 'screen'
      ? screenShareAudioTrack
      : microphoneAudioTrack ?? fallbackAudioTrack

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
  const showActivity = tileType === 'screen' ? isScreenAudioActive : isSpeaking

  return (
    <article
      className={cn(
        'group overflow-hidden rounded-xl border border-border/60',
        showVideo
          ? 'bg-black'
          : 'bg-gradient-to-br from-card/90 via-card/80 to-muted/25 p-2.5',
        showActivity &&
          (tileType === 'screen'
            ? 'border-sky-400/80 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]'
            : 'border-emerald-400/80 shadow-[0_0_0_1px_rgba(52,211,153,0.35)]'),
      )}
    >
      {showVideo ? (
        <div className="relative overflow-hidden bg-black">
          <div className="aspect-video">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-black/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <p className="min-w-0 truncate text-sm font-semibold text-white">
              {tileType === 'screen' ? `${displayName} Screen` : displayName}
            </p>
            {isLocal ? (
              <Badge variant="outline" className="h-5 border-white/40 bg-black/35 px-1.5 text-[10px] text-white">
                You
              </Badge>
            ) : null}
          </div>
          {!isLocal ? <audio ref={audioRef} autoPlay data-letschat-audio="remote" /> : null}
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-none">
                {tileType === 'screen' ? `${displayName} Screen` : displayName}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {joinedAt
                  ? `Joined ${new Date(joinedAt).toLocaleTimeString()}`
                  : tileType === 'screen'
                    ? 'Live screen stream'
                    : 'Participant'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {tileType === 'screen' && isScreenAudioActive ? (
                <Badge className="h-5 px-1.5 text-[10px]">Screen audio</Badge>
              ) : null}
              {tileType !== 'screen' && isSpeaking ? (
                <Badge className="h-5 px-1.5 text-[10px]">Speaking</Badge>
              ) : null}
              {isLocal ? <Badge variant="outline" className="h-5 px-1.5 text-[10px]">You</Badge> : null}
            </div>
          </div>

          <div className="relative flex min-h-[72px] items-center gap-3 rounded-lg bg-black/20 px-3 py-2">
            <Avatar className="size-[60px] shrink-0">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
              <AvatarFallback>{initials(displayName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{tileType === 'screen' ? 'No active stream' : 'Audio only'}</p>
              <p className="truncate text-xs text-muted-foreground">
                {tileType === 'screen'
                  ? (sharingScreen ? 'Screen stream is loading' : 'Start sharing to display content')
                  : 'Camera is currently off'}
              </p>
            </div>
            <div className="ml-auto shrink-0 text-muted-foreground/70">
              {tileType === 'screen' ? <MonitorUpIcon className="size-4" /> : <VideoOffIcon className="size-4" />}
            </div>
            {!isLocal ? <audio ref={audioRef} autoPlay data-letschat-audio="remote" /> : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {muted ? <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Muted</Badge> : null}
            {deafened ? <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Deafened</Badge> : null}
            {sharingCamera ? <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Camera</Badge> : null}
          </div>
        </>
      )}
    </article>
  )
}
