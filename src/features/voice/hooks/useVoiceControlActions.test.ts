import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Room } from 'livekit-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaDeviceStore } from '../../../stores/mediaDeviceStore'
import { useVoiceControlActions } from './useVoiceControlActions'

const guard = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/livekit', () => ({
  assertActiveCallRoom: guard,
  isCallCancelled: (error: Error) => error.name === 'AbortError',
  getCameraErrorMessage: (error: Error) => error.message,
  getMicrophoneUnavailableReason: () => '', requestMicrophonePermission: vi.fn(),
  setLocalCameraEnabled: vi.fn(), supportsMicrophoneCapture: () => true, switchRoomDevice: vi.fn(),
}))

afterEach(() => {
  guard.mockReset()
  useMediaDeviceStore.setState({ screenShareQuality: 'auto', screenShareAudio: false })
})

function controls() {
  const localParticipant = {
    isScreenShareEnabled: false,
    setScreenShareEnabled: vi.fn(async (enabled: boolean) => { localParticipant.isScreenShareEnabled = enabled; return undefined }),
  }
  const patchVoiceState = vi.fn(async () => {})
  const setError = vi.fn()
  let actions!: ReturnType<typeof useVoiceControlActions>
  function Harness() {
    actions = useVoiceControlActions({
      room: { localParticipant } as unknown as Room,
      selfState: { muted: false, deafened: false, sharingCamera: false, sharingScreen: false },
      audioInputId: null, videoInputId: null, hasScreenCapture: true, setError, patchVoiceState,
      onLeaveRoom: async () => {}, leaveErrorMessage: '',
    })
    return null
  }
  renderToStaticMarkup(createElement(Harness))
  return { actions, localParticipant, patchVoiceState, setError }
}

describe('screen share controls shared by channels and DMs', () => {
  it('uses the latest saved options and stops using actual media state even before presence catches up', async () => {
    const { actions, localParticipant, patchVoiceState } = controls()
    useMediaDeviceStore.setState({ screenShareQuality: '720p60', screenShareAudio: true })
    await actions.onToggleScreenShare()
    expect(localParticipant.setScreenShareEnabled).toHaveBeenLastCalledWith(true,
      expect.objectContaining({ resolution: { width: 1280, height: 720, frameRate: 60 } }),
      expect.objectContaining({ screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 60 } }),
    )
    expect(patchVoiceState).toHaveBeenLastCalledWith({ sharingScreen: true })
    await actions.onToggleScreenShare()
    expect(localParticipant.setScreenShareEnabled.mock.calls[1][0]).toBe(false)
    expect(patchVoiceState).toHaveBeenLastCalledWith({ sharingScreen: false })
  })

  it('does not claim a screen share if capture is denied or the call ends during the picker', async () => {
    const { actions, localParticipant, patchVoiceState, setError } = controls()
    localParticipant.setScreenShareEnabled.mockRejectedValueOnce(new DOMException('Capture denied', 'NotAllowedError'))
    await actions.onToggleScreenShare()
    expect(patchVoiceState).not.toHaveBeenCalled()
    expect(setError).toHaveBeenLastCalledWith('Capture denied')
    guard.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new DOMException('Call cancelled', 'AbortError') })
    await actions.onToggleScreenShare()
    expect(patchVoiceState).not.toHaveBeenCalled()
  })
})
