import './noise-filter-storage'
import { createRoot } from 'react-dom/client'
import { ConnectionState, Room } from 'livekit-client'
import { ActiveCallCard } from '../../src/layouts/app-layout/ActiveCallCard'
import { CallPanel } from '../../src/features/voice/components/CallPanel'
import { useActiveCall } from '../../src/features/voice/hooks/useActiveCall'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { useConnectionStore } from '../../src/stores/connectionStore'
import { useVoiceSessionStore } from '../../src/stores/voiceSessionStore'
import { useVoiceStore } from '../../src/stores/voiceStore'
import type { VoiceParticipant } from '../../src/types/domain'
import '../../src/index.css'

// Simulated devices: no permission prompt, no capture. `?nocamera` removes the camera,
// `?noscreen` removes screen capture, `?connecting` shows the transient disabled state.
const params = new URLSearchParams(location.search)
document.documentElement.classList.toggle('dark', !params.has('light'))
const device = (kind: MediaDeviceKind, label: string) => ({ kind, label, deviceId: `${kind}-1`, groupId: 'g' }) as MediaDeviceInfo
const devices = [device('audioinput', 'Studio microphone'), device('audiooutput', 'Headphones'), ...(params.has('nocamera') ? [] : [device('videoinput', 'FaceTime HD Camera')])]
navigator.mediaDevices.enumerateDevices = async () => devices
if (params.has('noscreen')) Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined })

const room = new Room()
Object.assign(room, { state: params.has('connecting') ? ConnectionState.Connecting : ConnectionState.Connected })
useConnectionStore.setState({ identity: 'self' })
useVoiceSessionStore.setState({ room, joinedChannelId: 1 })
useVoiceStore.setState({ participantsByChannel: { 1: [{ userIdentity: 'self', muted: false, deafened: false, sharingCamera: false, sharingScreen: false }] as VoiceParticipant[] } })

function Panel() {
  return <CallPanel call={useActiveCall()} />
}

export function Fixture() {
  return <TooltipProvider><main className="space-y-6 p-4">
    <nav className="flex gap-3 text-sm underline">
      <a href="?">Camera + screen</a><a href="?nocamera">No camera</a><a href="?noscreen">No screen capture</a><a href="?connecting">Connecting</a>
    </nav>
    <div className="flex flex-wrap items-start gap-4">
      {[220, 300].map(width => <div key={width} style={{ width }}><p className="mb-1 text-xs text-muted-foreground">Sidebar {width}px</p><ActiveCallCard /></div>)}
    </div>
    <div className="h-[30rem] max-w-4xl rounded-xl border"><Panel /></div>
  </main></TooltipProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
