// Transport fake used only by call-reload.vite.ts, never by the application build.
export const ConnectionState = { Connected: 'connected', Disconnected: 'disconnected' }
export const RoomEvent = { Disconnected: 'disconnected' }
export const Track = { Source: { Camera: 'camera', ScreenShare: 'screen_share', Microphone: 'microphone' } }
export class Room extends EventTarget {
  state = ConnectionState.Disconnected
  localParticipant = { isMicrophoneEnabled: false, trackPublications: new Map() }
  remoteParticipants = new Map()
  async connect() { this.state = ConnectionState.Connected }
  async disconnect() { this.state = ConnectionState.Disconnected; this.emit(RoomEvent.Disconnected) }
  on(event: string, callback: EventListener) { this.addEventListener(event, callback); return this }
  off(event: string, callback: EventListener) { this.removeEventListener(event, callback); return this }
  emit(event: string) { this.dispatchEvent(new Event(event)) }
}
