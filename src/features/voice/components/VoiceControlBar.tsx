import { MicIcon, MicOffIcon, MonitorUpIcon, PhoneOffIcon, VideoIcon, VolumeXIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

type VoiceControlBarProps = {
  joined: boolean
  connecting: boolean
  muted: boolean
  deafened: boolean
  sharingCamera: boolean
  sharingScreen: boolean
  hasScreenCapture: boolean
  error: string | null
  joinLabel?: string
  onJoin: () => Promise<void> | void
  onToggleMute: () => Promise<void> | void
  onToggleDeafen: () => Promise<void> | void
  onToggleCamera: () => Promise<void> | void
  onToggleScreenShare: () => Promise<void> | void
  onLeave: () => Promise<void> | void
}

export function VoiceControlBar({
  joined,
  connecting,
  muted,
  deafened,
  sharingCamera,
  sharingScreen,
  hasScreenCapture,
  error,
  joinLabel = 'Join Voice',
  onJoin,
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  onToggleScreenShare,
  onLeave,
}: VoiceControlBarProps) {
  return (
    <>
      {!joined ? (
        <Button disabled={connecting} onClick={onJoin}>
          <MicIcon className="size-4" />
          {connecting ? 'Joining...' : joinLabel}
        </Button>
      ) : (
        <>
          <Button variant={muted ? 'secondary' : 'outline'} onClick={onToggleMute}>
            {muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
            {muted ? 'Unmute' : 'Mute'}
          </Button>
          <Button variant={deafened ? 'secondary' : 'outline'} onClick={onToggleDeafen}>
            <VolumeXIcon className="size-4" />
            {deafened ? 'Undeafen' : 'Deafen'}
          </Button>
          <Button variant={sharingCamera ? 'secondary' : 'outline'} onClick={onToggleCamera}>
            <VideoIcon className="size-4" />
            {sharingCamera ? 'Stop Camera' : 'Camera'}
          </Button>
          <Button
            variant={sharingScreen ? 'secondary' : 'outline'}
            disabled={!hasScreenCapture}
            onClick={onToggleScreenShare}
          >
            <MonitorUpIcon className="size-4" />
            {sharingScreen ? 'Stop Share' : 'Share Screen'}
          </Button>
          <Button variant="destructive" onClick={onLeave}>
            <PhoneOffIcon className="size-4" />
            Leave
          </Button>
        </>
      )}
      {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
    </>
  )
}
