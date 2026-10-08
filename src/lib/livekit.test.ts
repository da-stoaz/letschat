import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'livekit-client'
import { useVoiceSessionStore } from '../stores/voiceSessionStore'
import { useDmVoiceSessionStore } from '../stores/dmVoiceSessionStore'

const mocks = vi.hoisted(() => ({
  identity: 'identity-abc' as string | null,
  order: [] as string[],
  rooms: [] as Room[],
  joinVoice: vi.fn<(id: number) => Promise<void>>(async () => {}),
  leaveVoice: vi.fn<(id: number) => Promise<void>>(async () => {}),
  joinDm: vi.fn<(id: string) => Promise<void>>(async () => {}),
  leaveDm: vi.fn<(id: string) => Promise<void>>(async () => {}),
  token: vi.fn<(room: string) => Promise<string>>(async () => 'livekit-token'),
  connect: vi.fn(async () => {}),
  toastError: vi.fn(),
  toastDismiss: vi.fn(),
}))

vi.mock('./spacetimedb', () => ({
  reducers: {
    joinVoiceChannel: (id: number) => { mocks.order.push(`join:${id}`); return mocks.joinVoice(id) },
    leaveVoiceChannel: (id: number) => { mocks.order.push(`leave:${id}`); return mocks.leaveVoice(id) },
    updateVoiceState: vi.fn(async () => {}),
    joinDmVoice: (id: string) => { mocks.order.push(`join:dm:${id}`); return mocks.joinDm(id) },
    leaveDmVoice: (id: string) => { mocks.order.push(`leave:dm:${id}`); return mocks.leaveDm(id) },
    updateDmVoiceState: vi.fn(async () => {}),
  },
}))
vi.mock('./tauri', () => ({
  tauriCommands: {
    getLivekitUrl: async () => 'ws://127.0.0.1:7880',
    generateLivekitToken: (room: string) => { mocks.order.push(`token:${room}`); return mocks.token(room) },
  },
}))
vi.mock('../stores/connectionStore', () => ({
  useConnectionStore: { getState: () => ({ identity: mocks.identity }) },
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, dismiss: mocks.toastDismiss } }))
vi.mock('livekit-client', () => {
  class FakeRoom {
    state = 'disconnected'
    localParticipant = {
      trackPublications: new Map([['mic', { track: { stop: vi.fn(() => mocks.order.push('stopCapture')) } }]]),
      setMicrophoneEnabled: vi.fn(async () => {}),
      setCameraEnabled: vi.fn(async () => {}),
    }
    remoteParticipants = new Map([['remote', {
      audioTrackPublications: new Map([['audio', { audioTrack: {
        detach: vi.fn(() => [{ pause: vi.fn(), srcObject: null }]),
      } }]]),
    }]])
    constructor() { mocks.rooms.push(this as unknown as Room) }
    async connect() {
      mocks.order.push('connect')
      await mocks.connect()
      this.state = 'connected'
    }
    disconnect = vi.fn(async () => { this.state = 'disconnected'; mocks.order.push('disconnect') })
    switchActiveDevice = vi.fn(async () => true)
    on() { return this }
    off() { return this }
  }
  return {
    Room: FakeRoom,
    ConnectionState: { Connected: 'connected', Connecting: 'connecting', Disconnected: 'disconnected' },
    Track: { Source: { Camera: 'camera', ScreenShare: 'screen_share', Microphone: 'microphone' } },
  }
})

const {
  joinLiveKitVoice, joinLiveKitDmVoice, leaveLiveKitVoice, leaveLiveKitDmVoice,
  resetCallSessions, retryCallCleanup,
  setLocalCameraEnabled,
} = await import('./livekit')

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  resetCallSessions()
  await retryCallCleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.identity = 'identity-abc'
  mocks.order.length = 0
  mocks.rooms.length = 0
  mocks.token.mockResolvedValue('livekit-token')
})

describe('call ownership and recovery', () => {
  it('claims presence before minting the authorized token for channel and DM calls', async () => {
    await joinLiveKitVoice(42)
    expect(mocks.order.slice(0, 3)).toEqual(['join:42', 'token:42', 'connect'])
    await joinLiveKitDmVoice('partner')
    expect(mocks.order.indexOf('token:dm:identity-abc:partner')).toBeGreaterThan(mocks.order.indexOf('join:dm:partner'))
  })

  it('releases presence and clears joining state when token minting fails', async () => {
    mocks.token.mockRejectedValueOnce(new Error('Invalid auth session.'))
    await expect(joinLiveKitVoice(42)).rejects.toThrow('Invalid auth session.')
    expect(mocks.order).toEqual(['join:42', 'token:42', 'leave:42'])
    expect(useVoiceSessionStore.getState()).toMatchObject({ room: null, joinedChannelId: null, joining: false })
  })

  it('does not release another session\'s presence when the join itself is rejected', async () => {
    mocks.joinVoice.mockRejectedValueOnce(new Error('Channel is full'))
    await expect(joinLiveKitVoice(42)).rejects.toThrow('Channel is full')
    expect(mocks.leaveVoice).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled()
    expect(useVoiceSessionStore.getState().joining).toBe(false)
  })

  it.each(['channel', 'dm'] as const)('stops %s capture and clears local ownership before a failed backend leave', async kind => {
    const room = kind === 'channel' ? await joinLiveKitVoice(42) : await joinLiveKitDmVoice('partner')
    const leave = deferred()
    if (kind === 'channel') mocks.leaveVoice.mockReturnValueOnce(leave.promise)
    else mocks.leaveDm.mockReturnValueOnce(leave.promise)
    const ending = kind === 'channel' ? leaveLiveKitVoice(42, room) : leaveLiveKitDmVoice('partner', room)
    expect(room.disconnect).toHaveBeenCalled()
    expect(room.localParticipant.trackPublications.get('mic')!.track!.stop).toHaveBeenCalled()
    expect(useVoiceSessionStore.getState().room).toBeNull()
    expect(useDmVoiceSessionStore.getState().room).toBeNull()
    leave.reject(new Error('Backend offline'))
    await ending
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('Call ended on this device'), expect.objectContaining({ action: expect.objectContaining({ label: 'Retry' }) }))
    await retryCallCleanup()
    expect(kind === 'channel' ? mocks.leaveVoice : mocks.leaveDm).toHaveBeenCalledTimes(2)
  })

  it('releases all local capture tracks and silences attached remote audio on hang-up', async () => {
    const room = await joinLiveKitVoice(42)
    const camera = { stop: vi.fn() }
    const screen = { stop: vi.fn() }
    room.localParticipant.trackPublications.set('camera', { track: camera } as never)
    room.localParticipant.trackPublications.set('screen', { track: screen } as never)
    const element = { pause: vi.fn(), srcObject: {} }
    const detach = vi.fn(() => [element])
    room.remoteParticipants.values().next().value!.audioTrackPublications.set('audio', { audioTrack: { detach } } as never)
    await leaveLiveKitVoice(42, room)
    expect(camera.stop).toHaveBeenCalled()
    expect(screen.stop).toHaveBeenCalled()
    expect(element.pause).toHaveBeenCalled()
    expect(element.srcObject).toBeNull()
  })

  it('closes a channel call before joining a DM and closes the DM before joining another channel', async () => {
    const channel = await joinLiveKitVoice(42)
    const dm = await joinLiveKitDmVoice('partner')
    expect(channel.disconnect).toHaveBeenCalled()
    expect(mocks.order.indexOf('stopCapture')).toBeLessThan(mocks.order.indexOf('join:dm:partner'))
    expect(useVoiceSessionStore.getState().room).toBeNull()
    expect(useDmVoiceSessionStore.getState().room).toBe(dm)
    const next = await joinLiveKitVoice(43)
    expect(dm.disconnect).toHaveBeenCalled()
    expect(useVoiceSessionStore.getState().room).toBe(next)
    expect(useDmVoiceSessionStore.getState()).toMatchObject({ room: null, joinedPartnerIdentity: null })
    expect(mocks.leaveDm).toHaveBeenCalledWith('partner')
  })

  it('never installs a late join after a newer call was requested', async () => {
    const token = deferred<string>()
    mocks.token.mockReturnValueOnce(token.promise)
    const first = joinLiveKitVoice(42).catch(error => error)
    await vi.waitFor(() => expect(mocks.token).toHaveBeenCalled())
    const next = joinLiveKitDmVoice('partner')
    token.resolve('late-token')
    expect(await first).toMatchObject({ name: 'AbortError' })
    const room = await next
    expect(mocks.rooms).toHaveLength(1)
    expect(useVoiceSessionStore.getState().room).toBeNull()
    expect(useDmVoiceSessionStore.getState().room).toBe(room)
    expect(mocks.order.indexOf('leave:42')).toBeLessThan(mocks.order.indexOf('join:dm:partner'))
  })

  it('cancels a connecting room immediately and never enables its microphone after cancellation', async () => {
    const connecting = deferred()
    mocks.connect.mockReturnValueOnce(connecting.promise)
    const joining = joinLiveKitVoice(42).catch(error => error)
    await vi.waitFor(() => expect(mocks.rooms).toHaveLength(1))
    const room = mocks.rooms[0]
    const ending = leaveLiveKitVoice(42, null)
    expect(room.disconnect).toHaveBeenCalled()
    expect(useVoiceSessionStore.getState().joining).toBe(false)
    expect(await joining).toMatchObject({ name: 'AbortError' })
    await ending
    const next = await joinLiveKitDmVoice('partner')
    connecting.resolve()
    await vi.waitFor(() => expect(room.state).toBe('disconnected'))
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
    expect(useVoiceSessionStore.getState().room).toBeNull()
    expect(useDmVoiceSessionStore.getState().room).toBe(next)
  })

  it('cannot resurrect a call after sign-out or release presence in a new account', async () => {
    const token = deferred<string>()
    mocks.token.mockReturnValueOnce(token.promise)
    const joining = joinLiveKitDmVoice('partner').catch(error => error)
    await vi.waitFor(() => expect(mocks.token).toHaveBeenCalled())
    resetCallSessions()
    mocks.identity = 'new-account'
    token.resolve('old-account-token')
    expect(await joining).toMatchObject({ name: 'AbortError' })
    expect(mocks.rooms).toHaveLength(0)
    expect(mocks.leaveDm).not.toHaveBeenCalled()
    expect(useDmVoiceSessionStore.getState()).toMatchObject({ room: null, joining: false })
  })

  it('stops a room waiting for microphone permission and does not publish after sign-out', async () => {
    const permission = deferred<MediaStream>()
    const getUserMedia = vi.fn(() => permission.promise)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const joining = joinLiveKitVoice(42).catch(error => error)
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    const room = mocks.rooms[0]
    resetCallSessions()
    expect(room.disconnect).toHaveBeenCalled()
    const stop = vi.fn()
    permission.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    expect(await joining).toMatchObject({ name: 'AbortError' })
    expect(stop).toHaveBeenCalled()
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
  })

  it('can join a new call while an old microphone permission prompt is still pending', async () => {
    const permission = deferred<MediaStream>()
    const stop = vi.fn()
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
    const getUserMedia = vi.fn().mockReturnValueOnce(permission.promise).mockResolvedValue(stream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const first = joinLiveKitVoice(42).catch(error => error)
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    const oldRoom = mocks.rooms[0]
    const next = await joinLiveKitDmVoice('partner')
    expect(await first).toMatchObject({ name: 'AbortError' })
    expect(useDmVoiceSessionStore.getState().room).toBe(next)
    permission.resolve(stream)
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2))
    expect(oldRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
  })

  it('ignores an old hang-up handler after rejoining the same channel', async () => {
    const old = await joinLiveKitVoice(42)
    await leaveLiveKitVoice(42, old)
    const current = await joinLiveKitVoice(42)
    await leaveLiveKitVoice(42, old)
    expect(current.disconnect).not.toHaveBeenCalled()
    expect(useVoiceSessionStore.getState().room).toBe(current)
    expect(mocks.leaveVoice).toHaveBeenCalledTimes(1)
  })

  it('stops a camera that finishes enabling after hang-up without retrying capture', async () => {
    const room = await joinLiveKitVoice(42)
    const camera = deferred()
    vi.mocked(room.localParticipant.setCameraEnabled).mockImplementationOnce(async () => {
      await camera.promise
      room.localParticipant.trackPublications.set('camera', { track: { stop } } as never)
      return undefined
    })
    const stop = vi.fn()
    const enabling = setLocalCameraEnabled(room, true, 'camera-id').catch(error => error)
    await vi.waitFor(() => expect(room.localParticipant.setCameraEnabled).toHaveBeenCalled())
    await leaveLiveKitVoice(42, room)
    camera.resolve()
    expect(await enabling).toMatchObject({ name: 'AbortError' })
    expect(stop).toHaveBeenCalled()
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1)
  })

  it('does not resurface an old cleanup error after switching accounts', async () => {
    const room = await joinLiveKitVoice(42)
    const cleanup = deferred()
    mocks.leaveVoice.mockReturnValueOnce(cleanup.promise)
    const ending = leaveLiveKitVoice(42, room)
    await vi.waitFor(() => expect(mocks.leaveVoice).toHaveBeenCalled())
    resetCallSessions()
    mocks.identity = 'new-account'
    cleanup.reject(new Error('Old cleanup failed'))
    await ending
    expect(mocks.toastError).not.toHaveBeenCalled()
    await retryCallCleanup()
    expect(mocks.leaveVoice).toHaveBeenCalledTimes(1)
  })

  it('does not let cleanup retries remove a newer call to the same target', async () => {
    const old = await joinLiveKitVoice(42)
    mocks.leaveVoice.mockRejectedValueOnce(new Error('Offline'))
    await leaveLiveKitVoice(42, old)
    const current = await joinLiveKitVoice(42)
    await retryCallCleanup()
    expect(mocks.leaveVoice).toHaveBeenCalledTimes(1)
    expect(useVoiceSessionStore.getState().room).toBe(current)
    expect(current.disconnect).not.toHaveBeenCalled()
  })

  it('drops queued cleanup retries on sign-out', async () => {
    const room = await joinLiveKitDmVoice('partner')
    mocks.leaveDm.mockRejectedValueOnce(new Error('Offline'))
    await leaveLiveKitDmVoice('partner', room)
    resetCallSessions()
    mocks.identity = 'new-account'
    await retryCallCleanup()
    expect(mocks.leaveDm).toHaveBeenCalledTimes(1)
  })
})
