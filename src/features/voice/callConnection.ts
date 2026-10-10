import { ConnectionState } from 'livekit-client'

export function callConnection(state: ConnectionState, joining: boolean) {
  const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting
  const connecting = !reconnecting && (joining || state === ConnectionState.Connecting)
  const connected = !connecting && state === ConnectionState.Connected
  const status = reconnecting ? 'Reconnecting…' : connecting ? 'Connecting…' : connected ? 'Connected' : 'Call ended'
  return { connected, connecting, status }
}
