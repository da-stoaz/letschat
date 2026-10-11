import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConnectionState, Room, RoomEvent } from 'livekit-client'
import { useVoiceLifecycle } from '../../src/hooks/useVoiceLifecycle'
import { joinLiveKitVoice, leaveLiveKitVoice } from '../../src/lib/livekit'
import { reducers } from '../../src/lib/spacetimedb'
import { tauriCommands } from '../../src/lib/tauri'
import { useConnectionStore } from '../../src/stores/connectionStore'
import { useVoiceSessionStore } from '../../src/stores/voiceSessionStore'
import { useServerConfigStore } from '../../src/stores/serverConfigStore'
import '../../src/index.css'

// Use the real call controller and lifecycle hook, with transport-only fakes.
// No server connection, media capture or microphone permission is used here.
let claimed = false
let joins = 0
let connects = 0
let restoredBeforeSync = false
reducers.joinVoiceChannel = async () => { claimed = true; joins++ }
reducers.leaveVoiceChannel = async () => { claimed = false }
reducers.updateVoiceState = async () => {}
tauriCommands.getLivekitUrl = async () => 'ws://127.0.0.1:7880'
tauriCommands.generateLivekitToken = async () => {
  if (!claimed) throw new Error('Presence must be reclaimed before requesting a fresh token')
  return 'fixture-token'
}
Room.prototype.connect = async function () { connects++; this.state = ConnectionState.Connected }
Room.prototype.disconnect = async function () { this.state = ConnectionState.Disconnected; this.emit(RoomEvent.Disconnected) }

const PHASE = 'letschat.qa.call-reload'
const phase = sessionStorage.getItem(PHASE) ?? 'initial'
useServerConfigStore.setState({ config: {
  authServiceUrl: 'https://reload-fixture.test', spacetimedbDatabase: 'fixture',
  spacetimedbUri: 'ws://127.0.0.1:4300', livekitUrl: 'ws://127.0.0.1:7880',
} })
useConnectionStore.setState({ identity: 'fixture-self', status: 'connected', synced: phase !== 'reload' })

export function CallReloadRegression() {
  useVoiceLifecycle()
  const { room, joinedChannelId, joining, error } = useVoiceSessionStore()
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 5000)
    const sync = setTimeout(() => {
      if (phase !== 'reload') return
      restoredBeforeSync = connects !== 0
      useConnectionStore.getState().setSynced(true)
    }, 200)
    if (phase === 'initial') void joinLiveKitVoice(42, { muted: true, deafened: false }).catch(console.error)
    return () => { clearTimeout(timer); clearTimeout(sync) }
  }, [])
  const restored = room?.state === ConnectionState.Connected && joinedChannelId === 42 && !joining && !room.localParticipant.isMicrophoneEnabled
  const status = phase === 'left'
    ? (!room && !joining && joins === 0 ? 'PASS: no call restored after hang-up' : 'FAIL: call returned after hang-up')
    : restoredBeforeSync ? 'FAIL: call restored before data synchronization'
      : restored && connects === 1 && joins === 1
      ? (phase === 'reload' ? 'PASS: call restored once after real page reload, still muted' : 'Ready: muted call joined')
      : error || timedOut ? `FAIL: ${error ?? 'call did not reconnect'}` : 'Connecting…'
  return <main className="p-8 space-y-4">
    <h1 className="text-xl">Call reload regression</h1>
    <p role="status">{status}</p>
    <button className="border rounded p-2" disabled={!restored} onClick={() => {
      sessionStorage.setItem(PHASE, 'reload')
      window.location.reload()
    }}>Reload this fixture</button>
    <button className="border rounded p-2 ml-4" disabled={!restored} onClick={async () => {
      await leaveLiveKitVoice(42, room)
      sessionStorage.setItem(PHASE, 'left')
      window.location.reload()
    }}>Hang up and reload</button>
    <p>Uses real tab session storage, unload events and navigation type. Transport is simulated; no microphone is opened.</p>
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><CallReloadRegression /></StrictMode>)
