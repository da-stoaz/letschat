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
  const preferences = useCallAudioStore.getState()
  useMediaDeviceStore.getState().setNoiseFilterEnabled(false)
  useCallAudioStore.setState({ masterVolume: 50, participantVolumes: { publisher: { voice: 40, screen: 20 } } })
  useConnectionStore.setState({ identity: 'receiver' })
  useVoiceSessionStore.setState({ room: receiver, joinedChannelId: 42 })
  const self = { channelId: 42, userIdentity: 'receiver', joinedAt: new Date().toISOString(), muted: true, deafened: false, sharingScreen: false, sharingCamera: false }
  useVoiceStore.getState().setParticipants(42, [self])
  const screenAudio = publisher.localParticipant.getTrackPublication(Track.Source.Microphone)!.audioTrack!.mediaStreamTrack.clone()
  try {
    await publisher.localParticipant.publishTrack(screenAudio, { source: Track.Source.ScreenShareAudio })
    root.render(createElement('div', null, createElement(CallAudioRenderer), createElement(CallVolumeMixer, { room: receiver, deafened: false })))
    const volumes = (voice: number, screen: number) => {
      const remote = receiver.remoteParticipants.get('publisher')
      const mic = remote?.getTrackPublication(Track.Source.Microphone)?.audioTrack?.attachedElements[0]
      const stream = remote?.getTrackPublication(Track.Source.ScreenShareAudio)?.audioTrack?.attachedElements[0]
      return document.querySelectorAll('[data-letschat-audio="remote"]').length === 2
        && mic?.volume === voice && stream?.volume === screen
        && mic.muted === (voice === 0) && stream.muted === (screen === 0)
    }
    await waitForPlayback(() => volumes(0.2, 0.1), 'Channel voice/stream volume did not reach the audio sinks')
    // Exercise the actual accessible slider, not just the store setter.
    container.querySelector<HTMLButtonElement>('[aria-label="Call volume controls"]')!.click()
    await waitForPlayback(() => !!document.querySelector('input[type="range"]'), 'Volume mixer did not open')
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!
    const label = document.querySelector(`label[for="${CSS.escape(slider.id)}"]`)
    if (label?.textContent !== 'Call volume') throw new Error('Master volume slider has no accessible label')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '25')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await waitForPlayback(() => volumes(0.1, 0.05), 'Master slider did not update playback')
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
    root.unmount()
    container.remove()
    await publisher.localParticipant.unpublishTrack(screenAudio)
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
