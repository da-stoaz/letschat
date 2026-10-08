import { useLocation, useNavigate } from 'react-router-dom'
import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActiveCall } from '../hooks/useActiveCall'

export function MobileCallStrip() {
  const call = useActiveCall()
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname.replace(/\/+$/, '')
  if (!call.active || (pathname === '/app/call' || (call.channelId !== null && pathname === call.conversationPath))) return null
  return <aside aria-label="Ongoing call" className="mt-1.5 flex min-w-0 shrink-0 flex-col items-center gap-1 rounded-xl border bg-card px-2 py-1 md:hidden">
    <div className="flex w-full min-w-0 items-center gap-1">
      <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start px-1 py-2" onClick={() => navigate('/app/call', { state: { returnTo: location.pathname } })}>
        <PhoneIcon className="size-4 shrink-0 text-emerald-400" /><span className="min-w-0 text-left"><span className="block truncate text-sm">{call.title}</span><span className="block text-xs text-muted-foreground">Return to call</span></span>
      </Button>
      <Button variant={call.muted ? 'secondary' : 'ghost'} size="icon" disabled={!call.joined} aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={call.muted} onClick={() => void call.onToggleMute()}>{call.muted ? <MicOffIcon /> : <MicIcon />}</Button>
      <Button variant="destructive" size="icon" aria-label={call.connecting ? 'Cancel call' : 'End call'} onClick={() => void call.onLeave()}><PhoneOffIcon /></Button>
    </div>
    {call.error ? <p role="alert" className="max-h-16 w-full overflow-y-auto pb-1 text-xs break-words text-destructive">{call.error}</p> : null}
  </aside>
}
