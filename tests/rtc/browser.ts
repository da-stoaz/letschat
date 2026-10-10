import { Room, RoomEvent, Track } from 'livekit-client'
import { joinLiveKitVoice, leaveLiveKitVoice } from '../../src/lib/livekit'
import { useConnectionStore } from '../../src/stores/connectionStore'

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
