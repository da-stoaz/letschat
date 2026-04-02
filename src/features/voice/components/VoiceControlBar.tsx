import { MicIcon, MicOffIcon, MonitorUpIcon, PhoneOffIcon, VideoIcon, VolumeXIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
  const screenShareButtonClass = cn(
    'transition-all duration-150',
    sharingScreen
      ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100 shadow-[0_0_0_1px_rgba(52,211,153,0.45)] hover:border-emerald-300 hover:bg-emerald-500/30 hover:text-emerald-50'
      : 'border-border/70 bg-background/35 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
  )

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
            variant="outline"
            className={screenShareButtonClass}
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
