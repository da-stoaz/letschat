import './noise-filter-storage'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LocalAudioTrack, ParticipantEvent, Track, type Room } from 'livekit-client'
import { Button } from '../../src/components/ui/button'
import { NoiseFilterToggle } from '../../src/features/voice/components/NoiseFilterToggle'
import { useNoiseFilter } from '../../src/features/voice/hooks/useNoiseFilter'
import { useMediaDeviceStore } from '../../src/stores/mediaDeviceStore'
import { useNoiseFilterStore } from '../../src/stores/noiseFilterStore'
import { AudioTab } from '../../src/features/settings/AudioTab'
import '../../src/index.css'

// Audio checks must start with fresh contexts and a single React root after edits.
import.meta.hot?.on('vite:beforeUpdate', () => location.reload())
document.documentElement.classList.add('dark')
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(check: () => boolean, label: string) {
  const deadline = Date.now() + 45_000
  while (!check()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}.`); await delay(50) }
}

function microphoneRoom(track: LocalAudioTrack): Room {
  const listeners = new Map<string, Set<() => void>>()
  return { localParticipant: {
    getTrackPublication: (source: Track.Source) => source === Track.Source.Microphone ? { audioTrack: track } : undefined,
    on: (event: ParticipantEvent, callback: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback) },
    off: (event: ParticipantEvent, callback: () => void) => listeners.get(event)?.delete(callback),
  } } as unknown as Room
}

async function rms(analyser: AnalyserNode) {
  const values = new Float32Array(analyser.fftSize)
  let sum = 0
  for (let i = 0; i < 30; i++) {
    analyser.getFloatTimeDomainData(values)
    sum += values.reduce((total, value) => total + value * value, 0) / values.length
    await delay(20)
  }
  return Math.sqrt(sum / 30)
}

export function Fixture() {
  const [room, setRoom] = useState<Room | null>(null)
  const [result, setResult] = useState('Ready. No microphone, speakers, backend, or Cloud account is used.')
  const [running, setRunning] = useState(false)
  const status = useNoiseFilterStore(s => s.status)
  useNoiseFilter(room)

  async function run() {
    setRunning(true)
    setResult('Starting synthetic audio context…')
    const localOnly = new URLSearchParams(location.search).has('local')
    const broadband = new URLSearchParams(location.search).has('broadband')
    const model = new URLSearchParams(location.search).has('deepfilter') ? 'deepfilternet' : 'rnnoise'
    const context = new AudioContext({ sampleRate: 44_100, sinkId: { type: 'none' } } as AudioContextOptions)
    const send = new RTCPeerConnection({ iceServers: [] })
    const receive = new RTCPeerConnection({ iceServers: [] })
    let localTrack: LocalAudioTrack | undefined
    try {
      await context.resume()
      setResult(`Audio context ${context.state}. Creating WebRTC offer…`)
      // Deterministic fan-like noise, at a different rate from RNNoise.
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
      const samples = buffer.getChannelData(0)
      let seed = 12345
      for (let i = 0; i < samples.length; i++) { seed = (1664525 * seed + 1013904223) >>> 0; samples[i] = (seed / 2 ** 32 - 0.5) * 0.15 }
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const input = context.createMediaStreamDestination()
      const fan = context.createBiquadFilter()
      fan.type = broadband ? 'allpass' : 'lowpass'
      fan.frequency.value = 1_000
      source.connect(fan).connect(input)
      const inputAnalyser = context.createAnalyser()
      const inaudible = context.createGain()
      inaudible.gain.value = 0
      fan.connect(inputAnalyser).connect(inaudible).connect(context.destination)
      source.start()
      localTrack = new LocalAudioTrack(input.stream.getAudioTracks()[0], undefined, true, context)
      if (!localOnly) localTrack.sender = send.addTrack(localTrack.mediaStreamTrack, input.stream)
      send.onicecandidate = event => { if (event.candidate) void receive.addIceCandidate(event.candidate) }
      receive.onicecandidate = event => { if (event.candidate) void send.addIceCandidate(event.candidate) }
      let received: MediaStream | undefined
      receive.ontrack = event => { received = new MediaStream([event.track]) }
      if (!localOnly) {
        await send.setLocalDescription(await send.createOffer())
        await receive.setRemoteDescription(send.localDescription!)
        await receive.setLocalDescription(await receive.createAnswer())
        await send.setRemoteDescription(receive.localDescription!)
        setResult('Connecting synthetic WebRTC loopback…')
        await waitFor(() => !!received && send.connectionState === 'connected', 'WebRTC connection')
      } else { received = input.stream }
      const sink = new Audio()
      if (!localOnly) {
        sink.muted = true
        sink.srcObject = received!
        sink.hidden = true
        document.body.appendChild(sink)
        await sink.play()
      }
      let analysisSource = context.createMediaStreamSource(received!)
      const analyser = context.createAnalyser()
      analysisSource.connect(analyser)
      const silence = context.createGain()
      silence.gain.value = 0
      analyser.connect(silence).connect(context.destination)
      useMediaDeviceStore.getState().setNoiseFilterEnabled(false)
      useMediaDeviceStore.getState().setNoiseFilterModel(model)
      setRoom(microphoneRoom(localTrack))
      await waitFor(() => useNoiseFilterStore.getState().status === 'off', 'filter off')
      await delay(500)
      const raw = await rms(analyser)
      const inputLevel = await rms(inputAnalyser)
      setResult(`Raw received RMS: ${raw.toFixed(5)}. Enabling ${model}…`)
      useMediaDeviceStore.getState().setNoiseFilterEnabled(true)
      await waitFor(() => useNoiseFilterStore.getState().status === 'active', 'filter active')
      await delay(7000)
      if (localOnly) {
        analysisSource.disconnect()
        analysisSource = context.createMediaStreamSource(new MediaStream([localTrack.mediaStreamTrack]))
        analysisSource.connect(analyser)
        await delay(300)
      }
      const filtered = await rms(analyser)
      const outgoingAnalyser = context.createAnalyser()
      context.createMediaStreamSource(new MediaStream([localTrack.mediaStreamTrack])).connect(outgoingAnalyser).connect(inaudible)
      const outgoing = await rms(outgoingAnalyser)
      const attached = localTrack.sender?.track?.id === localTrack.getProcessor()?.processedTrack?.id
      const reduction = 20 * Math.log10(filtered / raw)
      if (raw < 0.005 || !Number.isFinite(reduction) || reduction > (broadband ? -3 : -10)) throw new Error(`Insufficient received-noise reduction: ${reduction.toFixed(1)} dB (raw ${raw}, filtered ${filtered}, audio time ${context.currentTime}, input ${inputLevel}, receiver muted ${received!.getAudioTracks()[0].muted}, outgoing ${outgoing}, sender replaced ${attached}).`)
      setResult(`Received noise: ${reduction.toFixed(1)} dB. Checking bypass…`)
      useMediaDeviceStore.getState().setNoiseFilterEnabled(false)
      await waitFor(() => useNoiseFilterStore.getState().status === 'off', 'filter off')
      await delay(500)
      if (localOnly) {
        analysisSource.disconnect()
        analysisSource = context.createMediaStreamSource(input.stream)
        analysisSource.connect(analyser)
        await delay(300)
      }
      const bypass = await rms(analyser)
      if (bypass < raw * 0.7) throw new Error('Disabling the filter did not restore the original signal.')
      // Exercise actual sender replacement in both directions during the call.
      useMediaDeviceStore.getState().setNoiseFilterEnabled(true)
      await waitFor(() => useNoiseFilterStore.getState().status === 'active', 'first model active again')
      const other = model === 'rnnoise' ? 'deepfilternet' : 'rnnoise'
      useMediaDeviceStore.getState().setNoiseFilterModel(other)
      await waitFor(() => useNoiseFilterStore.getState().status === 'active' && localTrack!.getProcessor()?.name === `letschat-${other}`, 'second model active')
      if (!localOnly && localTrack.sender?.track !== localTrack.getProcessor()?.processedTrack) throw new Error('Switch did not replace the WebRTC sender track.')
      useMediaDeviceStore.getState().setNoiseFilterModel(model)
      await waitFor(() => useNoiseFilterStore.getState().status === 'active' && localTrack!.getProcessor()?.name === `letschat-${model}`, 'original model restored')
      if (!localOnly && localTrack.sender?.track !== localTrack.getProcessor()?.processedTrack) throw new Error('Switch back did not replace the WebRTC sender track.')
      setResult(`PASS · ${model}: ${localOnly ? 'Local processor' : 'Real WebRTC received'} noise reduction ${reduction.toFixed(1)} dB; bypass and switching both models restored. 44.1 kHz input → 48 kHz filtering. No microphone or audible output. Open the popover to verify the switch, Escape, and focus return.`)
      // Keep the synthetic call running for manual popover / toggle inspection.
      setRunning(false)
      window.addEventListener('pagehide', () => { sink.pause(); sink.srcObject = null; sink.remove(); localTrack?.stop(); send.close(); receive.close(); void context.close() }, { once: true })
      return
    } catch (error) { setResult(`FAIL · ${error instanceof Error ? error.message : String(error)}`) }
    setRoom(null)
    localTrack?.stop()
    send.close()
    receive.close()
    await context.close()
    setRunning(false)
  }

  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-6">
    <div><h1 className="text-xl font-semibold">Noise suppression</h1><p className="mt-2 text-sm text-muted-foreground">Real RNNoise / DeepFilterNet, LiveKit track replacement and a local WebRTC loopback.</p></div>
    <AudioTab />
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4"><NoiseFilterToggle compact /><NoiseFilterToggle /><span className="text-sm text-muted-foreground">Processor: {status}</span></div>
    <Button disabled={running || room !== null} onClick={() => void run()}>Run audio verification</Button>
    <p role="status" className="break-words text-sm leading-relaxed">{result}</p>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
