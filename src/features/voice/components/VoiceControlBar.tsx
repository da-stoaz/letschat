import { ArrowLeftIcon, MicIcon, MicOffIcon, MoreHorizontalIcon, PhoneOffIcon, VideoIcon, VideoOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UnavailableButton } from '@/components/UnavailableButton'
import type { ActiveCall } from '../hooks/useActiveCall'
import { CallError } from './CallError'

export function VoiceControlBar({ call, onMore, onBack }: { call: ActiveCall; onMore?: () => void; onBack?: () => void }) {
  return (
    <div className="shrink-0 border-t pt-2">
      <CallError message={call.error} className="mb-2 max-h-20 overflow-y-auto text-sm" />
      <div role="group" aria-label="Call controls" className="flex flex-wrap justify-center gap-2">
        {onBack ? <Button variant="outline" onClick={onBack}><ArrowLeftIcon />Back</Button> : null}
        <Button variant={call.muted ? 'secondary' : 'outline'} disabled={!call.joined} aria-pressed={call.muted} aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'} onClick={() => void call.onToggleMute()}>
          {call.muted ? <MicOffIcon /> : <MicIcon />}{call.muted ? 'Unmute' : 'Mute'}
        </Button>
        {call.cameraUnavailable && !call.sharingCamera
          ? <UnavailableButton variant="outline" reason={call.cameraUnavailable}><VideoOffIcon />No camera</UnavailableButton>
          : <Button variant={call.sharingCamera ? 'secondary' : 'outline'} disabled={!call.joined} aria-pressed={call.sharingCamera} aria-label={call.sharingCamera ? 'Stop camera' : 'Start camera'} onClick={() => void call.onToggleCamera()}>
            {call.sharingCamera ? <VideoIcon /> : <VideoOffIcon />}Camera
          </Button>}
        {onMore ? <Button variant="outline" onClick={onMore}><MoreHorizontalIcon />More</Button> : null}
        <Button variant="destructive" aria-label={call.connecting ? 'Cancel call' : 'End call'} onClick={() => void call.onLeave()}><PhoneOffIcon />{call.connecting ? 'Cancel' : 'End'}</Button>
      </div>
    </div>
  )
}
