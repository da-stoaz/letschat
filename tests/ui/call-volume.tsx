import './noise-filter-storage'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Room, Track, type RemoteParticipant } from 'livekit-client'
import { CallVolumeMixer } from '../../src/features/voice/components/CallVolumeMixer'
import { CallLatencyBadge } from '../../src/features/voice/components/CallLatencyBadge'
import { NoiseFilterToggle } from '../../src/features/voice/components/NoiseFilterToggle'
import { useNoiseFilterStore } from '../../src/stores/noiseFilterStore'
import { AudioTab } from '../../src/features/settings/AudioTab'
import { Button } from '../../src/components/ui/button'
import { useCallAudioStore } from '../../src/stores/callAudioStore'
import '../../src/index.css'

document.documentElement.classList.add('dark')
const room = new Room()
// Presentation fixture only; the RTC suite covers real tracks and playback.
for (const [identity, name] of [['alice', 'Alice'], ['bob', 'Bob with a longer display name']]) {
  room.remoteParticipants.set(identity, {
    identity, name, isLocal: false,
    getTrackPublication: (source: Track.Source) => identity === 'alice' && source === Track.Source.ScreenShareAudio ? {} : undefined,
  } as RemoteParticipant)
}
useCallAudioStore.setState({ masterVolume: 80, participantVolumes: { alice: { voice: 70, screen: 30 } } })
useNoiseFilterStore.setState({ status: 'active' })

export function Fixture() {
  const [deafened, setDeafened] = useState(false)
  return <main className="mx-auto max-w-xl space-y-6 p-4 sm:p-8">
    <h1 className="text-xl font-semibold">Call volume verification</h1>
    <p className="text-sm text-muted-foreground">No backend or audio capture. Changes use isolated in-memory storage.</p>
    <div className="flex flex-wrap gap-2">
      <CallVolumeMixer room={room} deafened={deafened} />
      <Button variant="outline" aria-pressed={deafened} onClick={() => setDeafened(!deafened)}>{deafened ? 'Unmute call audio' : 'Mute call audio'}</Button>
    </div>
    {[false, true].map(compact => <div key={String(compact)} className="flex items-center gap-2 rounded-xl border p-3">
      <span className="mr-auto text-sm">{compact ? 'Sidebar' : 'Call dock'}</span>
      <CallLatencyBadge room={room} compact={compact} />
      <NoiseFilterToggle compact={compact} />
      <CallVolumeMixer room={room} deafened={deafened} compact className={compact ? 'size-8 rounded-md' : 'size-9 rounded-md'} />
    </div>)}
    <AudioTab />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
