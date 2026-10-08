import { useEffect, useRef } from 'react'
import { Track, type LocalParticipant, type RemoteParticipant } from 'livekit-client'
import { MicOffIcon, VolumeXIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '../../../lib/utils'
import { MonitorUpIcon } from 'lucide-react'
import { getParticipantVideoTrack } from '../mediaTiles'

type MediaParticipant = LocalParticipant | RemoteParticipant

interface ParticipantMediaTileProps {
  displayName: string
  avatarUrl?: string | null
  joinedAt?: string
  participant: MediaParticipant | null
  tileType?: 'profile' | 'screen'
  className?: string
  stageClassName?: string
  avatarClassName?: string
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

export function ParticipantMediaTile({
  displayName,
  avatarUrl = null,
  participant,
  tileType = 'profile',
  className,
  stageClassName,
  avatarClassName,
  isLocal,
  isSpeaking,
  isScreenAudioActive = false,
  muted,
  deafened,
  sharingScreen,
}: ParticipantMediaTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const primaryVideoTrack = getParticipantVideoTrack(participant, tileType)

  // Remote audio is rendered by the app-shell-level CallAudioRenderer (so it
  // survives view navigation), not per-tile — keep this component video-only.

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

  const showVideo = Boolean(primaryVideoTrack && primaryVideoTrack.kind === Track.Kind.Video)
  const showActivity = tileType === 'screen' ? isScreenAudioActive : isSpeaking

  return (
    <article className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-muted/10',
      showActivity ? 'border-emerald-400/80' : 'border-border/60', className)}>
      <div className={cn('relative aspect-video overflow-hidden', stageClassName)}>
        {showVideo ? <video ref={videoRef} autoPlay playsInline muted
          aria-label={tileType === 'screen' ? `${displayName} screen share` : `${displayName} camera`}
          className="h-full w-full bg-black object-contain"><track kind="captions" /></video> : (
          <div className="grid h-full min-h-0 place-items-center">
            {tileType === 'profile' ? <Avatar className={cn('size-24 ring-1 ring-border/70', avatarClassName)}>
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-2xl font-semibold">{initials(displayName)}</AvatarFallback>
            </Avatar> : <div className="flex items-center gap-2 text-sm text-muted-foreground"><MonitorUpIcon className="size-5" />{sharingScreen ? 'Loading screen…' : 'No stream'}</div>}
          </div>
        )}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 bg-background/70 px-2 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate">{displayName}{isLocal ? ' (you)' : ''}{tileType === 'screen' ? ' · Screen' : ''}</span>
        {showActivity ? <span className="size-2 shrink-0 rounded-full bg-emerald-400" role="img" aria-label={tileType === 'screen' ? 'Screen audio active' : 'Speaking'} /> : null}
        {muted && tileType === 'profile' ? <MicOffIcon className="size-3.5 shrink-0" aria-label="Microphone muted" /> : null}
        {deafened ? <VolumeXIcon className="size-3.5 shrink-0" aria-label="Call audio muted" /> : null}
      </div>
    </article>
  )
}
