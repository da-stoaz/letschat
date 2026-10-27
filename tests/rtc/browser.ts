import { Room, RoomEvent, Track } from 'livekit-client'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { joinLiveKitVoice, leaveLiveKitVoice } from '../../src/lib/livekit'
import { useConnectionStore } from '../../src/stores/connectionStore'
import { useCallAudioStore } from '../../src/stores/callAudioStore'
import { useMediaDeviceStore } from '../../src/stores/mediaDeviceStore'
import { useVoiceSessionStore } from '../../src/stores/voiceSessionStore'
import { useVoiceStore } from '../../src/stores/voiceStore'
import { useDmVoiceSessionStore } from '../../src/stores/dmVoiceSessionStore'
import { useDmVoiceStore } from '../../src/stores/dmVoiceStore'
import { CallAudioRenderer } from '../../src/features/voice/components/CallAudioRenderer'
import { CallVolumeMixer } from '../../src/features/voice/components/CallVolumeMixer'

async function waitForPlayback(check: () => boolean, message: string) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function verifyCallVolume(receiver: Room, publisher: Room, token: string) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const meterContext = new AudioContext()
  await meterContext.resume()
  const meters = new Map<MediaStream, AnalyserNode>()
  const energy = (stream: MediaStream) => {
    let meter = meters.get(stream)
    if (!meter) {
      meter = meterContext.createAnalyser()
      meter.fftSize = 2048
      meterContext.createMediaStreamSource(stream).connect(meter)
      meters.set(stream, meter)
    }
    const samples = new Float32Array(meter.fftSize)
    meter.getFloatTimeDomainData(samples)
    return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
  }
  const preferences = useCallAudioStore.getState()
  useMediaDeviceStore.getState().setNoiseFilterEnabled(false)
  useCallAudioStore.setState({ masterVolume: 50, participantVolumes: { publisher: { voice: 40, screen: 20 } } })
  useConnectionStore.setState({ identity: 'receiver' })
  useVoiceSessionStore.setState({ room: receiver, joinedChannelId: 42 })
  const self = { channelId: 42, userIdentity: 'receiver', joinedAt: new Date().toISOString(), muted: true, deafened: false, sharingScreen: false, sharingCamera: false }
  useVoiceStore.getState().setParticipants(42, [self])
  // Use a quiet continuous tone for sample ratios; Chrome's fake microphone
  // has silent gaps and can clip when boosted. Call-manager capture is checked above.
  const oscillator = meterContext.createOscillator()
  const quiet = meterContext.createGain()
  quiet.gain.value = 0.05
  const tone = meterContext.createMediaStreamDestination()
  oscillator.connect(quiet).connect(tone)
  oscillator.start()
  const microphone = publisher.localParticipant.getTrackPublication(Track.Source.Microphone)!.audioTrack!
  await publisher.localParticipant.unpublishTrack(microphone)
  const micAudio = tone.stream.getAudioTracks()[0]
  const screenAudio = micAudio.clone()
  const NativeAudioContext = window.AudioContext
  const playbackContexts: AudioContext[] = []
  try {
    await publisher.localParticipant.publishTrack(micAudio, { source: Track.Source.Microphone })
    await publisher.localParticipant.publishTrack(screenAudio, { source: Track.Source.ScreenShareAudio })
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) { super(options); playbackContexts.push(this) }
    }
    root.render(createElement('div', null, createElement(CallAudioRenderer), createElement(CallVolumeMixer, { room: receiver, deafened: false })))
    const volumes = (voice: number, screen: number) => {
      const remote = receiver.remoteParticipants.get('publisher')
      return document.querySelectorAll('[data-letschat-audio="remote"]').length === 2
        && [[Track.Source.Microphone, voice], [Track.Source.ScreenShareAudio, screen]].every(([source, level]) => {
          const publication = remote?.getTrackPublication(source as Track.Source)
          const track = publication?.audioTrack
          const sink = [...document.querySelectorAll<HTMLAudioElement>('[data-letschat-audio="remote"]')]
            .find(element => element.dataset.playbackKey?.endsWith(`:${publication?.trackSid}`))
          if (!track?.mediaStream || !(sink?.srcObject instanceof MediaStream)) return false
          const input = energy(track.mediaStream)
          const output = energy(sink.srcObject)
          // Measure the samples delivered to the chosen output sink, not a stored gain value.
          return (level === 0 ? output < 0.00001 : input > 0.001 && Math.abs(output / input - Number(level)) < 0.08)
            && sink.muted === (level === 0)
            && track.attachedElements.every(element => element.volume === 0)
        })
    }
    await waitForPlayback(() => volumes(0.2, 0.1), 'Channel voice/stream volume did not reach the audio sinks')
    window.AudioContext = NativeAudioContext
    if (playbackContexts.length !== 1) throw new Error('Remote tracks should share one playback context')
    // Exercise the actual accessible slider, not just the store setter.
    container.querySelector<HTMLButtonElement>('[aria-label="Call volume controls"]')!.click()
    await waitForPlayback(() => !!document.querySelector('input[type="range"]'), 'Volume mixer did not open')
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!
    const label = document.querySelector(`label[for="${CSS.escape(slider.id)}"]`)
    if (label?.textContent !== 'Call volume') throw new Error('Master volume slider has no accessible label')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '25')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await waitForPlayback(() => volumes(0.1, 0.05), 'Master slider did not update playback')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '200')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    preferences.setParticipantVolume('publisher', 'voice', 100)
    preferences.setParticipantVolume('publisher', 'screen', 75)
    await waitForPlayback(() => volumes(2, 1.5), 'Boost did not amplify the samples reaching the output sinks')
    await playbackContexts[0].suspend()
    const enableAudio = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Enable audio')
    await waitForPlayback(() => !!enableAudio(), 'Suspended playback context did not offer audio recovery')
    enableAudio()!.click()
    await waitForPlayback(() => playbackContexts[0].state === 'running' && !enableAudio() && volumes(2, 1.5), 'Audio recovery did not restore boosted playback')
    useMediaDeviceStore.getState().setAudioOutputId('default')
    await waitForPlayback(() => [...document.querySelectorAll<HTMLAudioElement>('[data-letschat-audio="remote"]')]
      .every(element => (element as HTMLAudioElement & { sinkId: string }).sinkId === 'default'), 'Boosted playback lost output device routing')
    preferences.setParticipantVolume('publisher', 'voice', 40)
    preferences.setParticipantVolume('publisher', 'screen', 20)
    preferences.setMasterVolume(0)
    await waitForPlayback(() => volumes(0, 0), 'Master zero did not mute both sources')
    preferences.setMasterVolume(50)
    useVoiceStore.getState().setParticipants(42, [{ ...self, deafened: true }])
    await waitForPlayback(() => volumes(0, 0), 'Deafen did not mute both sources')
    preferences.setParticipantVolume('publisher', 'voice', 60)
    await new Promise(resolve => setTimeout(resolve, 50))
    if (!volumes(0, 0)) throw new Error('Changing volume bypassed deafen')
    useVoiceStore.getState().setParticipants(42, [self])
    await waitForPlayback(() => volumes(0.3, 0.1), 'Undeafen lost the saved mix')

    await receiver.disconnect()
    await waitForPlayback(() => playbackContexts[0].state === 'closed', 'Leaving the room leaked its playback context')
    await receiver.connect(window.rtcSignalUrl, token, { rtcConfig: { iceServers: [] }, peerConnectionTimeout: 5000 })
    await waitForPlayback(() => volumes(0.3, 0.1), 'New tracks after reconnect lost the saved mix')

    useVoiceSessionStore.setState({ room: null, joinedChannelId: null })
    useDmVoiceSessionStore.setState({ room: receiver, joinedPartnerIdentity: 'publisher' })
    const dmSelf = { ...self, roomKey: 'publisher:receiver', userA: 'publisher', userB: 'receiver' }
    useDmVoiceStore.getState().setRoomParticipants('publisher:receiver', [dmSelf])
    await waitForPlayback(() => volumes(0.3, 0.1), 'DM audio did not use the same preferences')
    useDmVoiceStore.getState().setRoomParticipants('publisher:receiver', [{ ...dmSelf, deafened: true }])
    await waitForPlayback(() => volumes(0, 0), 'DM deafen did not mute both sources')
  } finally {
    window.AudioContext = NativeAudioContext
    root.unmount()
    oscillator.stop()
    await meterContext.close()
    container.remove()
    await publisher.localParticipant.unpublishTrack(screenAudio)
    await publisher.localParticipant.unpublishTrack(micAudio)
    micAudio.stop()
    screenAudio.stop()
    useDmVoiceSessionStore.getState().reset()
    useVoiceSessionStore.setState({ room: publisher, joinedChannelId: 42 })
    useConnectionStore.setState({ identity: 'publisher' })
  }
}

// Deliberately withhold LAN candidates from signalling. ICE must work through
// the published server port, without a server-initiated shortcut to the client.
const NativePeerConnection = window.RTCPeerConnection
function withoutCandidates(description: RTCSessionDescriptionInit) {
  return { ...description, sdp: description.sdp?.split('\r\n').filter(line => !line.startsWith('a=candidate:')).join('\r\n') }
}
window.RTCPeerConnection = class extends NativePeerConnection {
  set onicecandidate(handler: RTCPeerConnection['onicecandidate']) {
    super.onicecandidate = handler ? event => { if (!event.candidate) handler.call(this, event) } : null
  }
  async createOffer(options?: RTCOfferOptions) { return withoutCandidates(await super.createOffer(options)) }
  get localDescription() {
    const description = super.localDescription
    return description ? new RTCSessionDescription(withoutCandidates(description)) : null
  }
}

declare global {
  interface Window {
    rtcSignalUrl: string
    rtcProbe: () => Promise<{ audioBytes: number; protocol: string }>
  }
}

window.rtcProbe = async () => {
  const receiver = new Room()
  let publisher: Room | null = null
  try {
    const { token } = await (await fetch('/token', { method: 'POST', body: JSON.stringify({ room: '42', identity: 'receiver' }) })).json()
    await receiver.connect(window.rtcSignalUrl, token, { rtcConfig: { iceServers: [] }, peerConnectionTimeout: 5000 })
    let audio: import('livekit-client').RemoteTrack | undefined
    receiver.on(RoomEvent.TrackSubscribed, track => {
      if (track.kind === Track.Kind.Audio) audio = track
    })
    useConnectionStore.setState({ identity: 'publisher' })
    publisher = await joinLiveKitVoice(42)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const stats = await audio?.getRTCStatsReport()
      for (const report of stats?.values() ?? []) {
        if (report.type === 'inbound-rtp' && report.bytesReceived > 0) {
          const transport = stats!.get(report.transportId)
          const pair = stats!.get(transport.selectedCandidatePairId)
          const candidate = stats!.get(pair.remoteCandidateId)
          await verifyCallVolume(receiver, publisher, token)
          return { audioBytes: report.bytesReceived, protocol: candidate.protocol }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('ICE connected but no audio packets arrived')
  } finally {
    await leaveLiveKitVoice(42, publisher)
    await receiver.disconnect()
  }
}
