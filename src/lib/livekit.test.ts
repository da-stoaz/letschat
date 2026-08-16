import { beforeEach, describe, expect, it, vi } from 'vitest'

// Guards the join ORDER, which is a cross-service contract and not obvious from
// this file alone: core-api authorises a LiveKit token against the SpacetimeDB
// voice-presence row (LiveKitEndpoints.IssueToken -> HasVoicePresenceAsync), so
// the client must claim presence BEFORE it mints the token. Minting first fails
// every join with 403 "You are not a participant in this voice room."

const order: string[] = []

const joinVoiceChannel = vi.fn(async () => {
  order.push('presence')
})
const leaveVoiceChannel = vi.fn(async () => {
  order.push('leavePresence')
})
const updateVoiceState = vi.fn(async () => {})
const joinDmVoice = vi.fn(async () => {
  order.push('presence')
})
const leaveDmVoice = vi.fn(async () => {})
const updateDmVoiceState = vi.fn(async () => {})

vi.mock('./spacetimedb', () => ({
  reducers: {
    joinVoiceChannel: () => joinVoiceChannel(),
    leaveVoiceChannel: () => leaveVoiceChannel(),
    updateVoiceState: () => updateVoiceState(),
    joinDmVoice: () => joinDmVoice(),
    leaveDmVoice: () => leaveDmVoice(),
    updateDmVoiceState: () => updateDmVoiceState(),
  },
}))

const generateLivekitToken = vi.fn(async () => {
  order.push('token')
  return 'livekit-token'
})

vi.mock('./tauri', () => ({
  tauriCommands: {
    getLivekitUrl: async () => 'ws://127.0.0.1:7880',
    generateLivekitToken: () => generateLivekitToken(),
  },
}))

vi.mock('../stores/connectionStore', () => ({
  useConnectionStore: { getState: () => ({ identity: 'identity-abc' }) },
}))

vi.mock('livekit-client', () => {
  class Room {
    localParticipant = { setMicrophoneEnabled: async () => {} }
    async connect() {
      order.push('livekitConnect')
    }
    disconnect() {}
    on() {
      return this
    }
    off() {
      return this
    }
  }
  return {
    Room,
    ConnectionState: { Connected: 'connected', Connecting: 'connecting', Disconnected: 'disconnected' },
    Track: { Source: { Camera: 'camera', ScreenShare: 'screen_share', Microphone: 'microphone' } },
  }
})

const { joinLiveKitVoice, joinLiveKitDmVoice } = await import('./livekit')

beforeEach(() => {
  order.length = 0
  joinVoiceChannel.mockClear()
  generateLivekitToken.mockClear()
})

describe('voice join order', () => {
  it('claims SpacetimeDB presence before minting the LiveKit token', async () => {
    await joinLiveKitVoice(42)

    expect(order.indexOf('presence')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('token')).toBeGreaterThan(order.indexOf('presence'))
    expect(order.indexOf('livekitConnect')).toBeGreaterThan(order.indexOf('token'))
  })

  it('claims DM voice presence before minting the token too', async () => {
    await joinLiveKitDmVoice('0xpartner')

    expect(order.indexOf('token')).toBeGreaterThan(order.indexOf('presence'))
  })

  it('releases presence when the token cannot be minted', async () => {
    generateLivekitToken.mockImplementationOnce(async () => {
      order.push('token')
      throw new Error('Invalid auth session.')
    })

    await expect(joinLiveKitVoice(42)).rejects.toThrow()
    expect(order).toEqual(['presence', 'token', 'leavePresence'])
  })
})
