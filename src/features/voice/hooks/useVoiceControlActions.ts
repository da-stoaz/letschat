import { useCallback } from 'react'
import type { RemoteParticipant, Room } from 'livekit-client'
import {
  assertActiveCallRoom,
  isCallCancelled,
  getCameraErrorMessage,
  getMicrophoneUnavailableReason,
  requestMicrophonePermission,
  setLocalCameraEnabled,
  supportsMicrophoneCapture,
  switchRoomDevice,
} from '../../../lib/livekit'

type VoiceStateSnapshot = {
  muted: boolean
  deafened: boolean
  sharingCamera: boolean
  sharingScreen: boolean
}

type VoicePatch = Partial<VoiceStateSnapshot>

type UseVoiceControlActionsArgs = {
  room: Room | null
  remoteParticipants?: RemoteParticipant[]
  selfState: VoiceStateSnapshot | null
  audioInputId: string | null
  videoInputId: string | null
  hasScreenCapture: boolean
  setError: (message: string | null) => void
  patchVoiceState: (patch: VoicePatch) => Promise<void>
  onLeaveRoom: () => Promise<void>
  leaveErrorMessage: string
}

export function useVoiceControlActions({
  room,
  remoteParticipants = [],
  selfState,
  audioInputId,
  videoInputId,
  hasScreenCapture,
  setError,
  patchVoiceState,
  onLeaveRoom,
  leaveErrorMessage,
}: UseVoiceControlActionsArgs) {
  const ensureMicrophoneCapture = useCallback(async () => {
    if (!supportsMicrophoneCapture()) {
      throw new Error(getMicrophoneUnavailableReason())
    }
    await requestMicrophonePermission()
  }, [])

  const onToggleMute = useCallback(async () => {
    if (!room || !selfState) return
    try {
      assertActiveCallRoom(room)
      setError(null)
      const nextMuted = !selfState.muted
      if (!nextMuted) {
        await ensureMicrophoneCapture()
        assertActiveCallRoom(room)
        if (audioInputId) {
          await switchRoomDevice(room, 'audioinput', audioInputId)
          assertActiveCallRoom(room)
        }
      }
      await room.localParticipant.setMicrophoneEnabled(!nextMuted)
      assertActiveCallRoom(room)
      await patchVoiceState({ muted: nextMuted })
    } catch (error) {
      if (isCallCancelled(error)) return
      try { assertActiveCallRoom(room) } catch { return }
      const message = error instanceof Error ? error.message : 'Could not toggle microphone.'
      setError(message)
    }
  }, [audioInputId, ensureMicrophoneCapture, patchVoiceState, room, selfState, setError])

  const onToggleDeafen = useCallback(async () => {
    if (!room || !selfState) return
    try {
      assertActiveCallRoom(room)
      setError(null)
      const nextDeafened = !selfState.deafened
      for (const participant of remoteParticipants) {
        participant.setVolume(nextDeafened ? 0 : 1)
      }
      await patchVoiceState({ deafened: nextDeafened })
    } catch (error) {
      if (isCallCancelled(error)) return
      try { assertActiveCallRoom(room) } catch { return }
      const message = error instanceof Error ? error.message : 'Could not toggle deafen.'
      setError(message)
    }
  }, [patchVoiceState, remoteParticipants, room, selfState, setError])

  const onToggleCamera = useCallback(async () => {
    if (!room || !selfState) return
    try {
      assertActiveCallRoom(room)
      setError(null)
      const nextCamera = !selfState.sharingCamera
      await setLocalCameraEnabled(room, nextCamera, videoInputId ?? undefined)
      assertActiveCallRoom(room)
      await patchVoiceState({ sharingCamera: nextCamera })
    } catch (error) {
      if (isCallCancelled(error)) return
      try { assertActiveCallRoom(room) } catch { return }
      setError(getCameraErrorMessage(error))
    }
  }, [patchVoiceState, room, selfState, setError, videoInputId])

  const onToggleScreenShare = useCallback(async () => {
    if (!room || !selfState) return
    try {
      assertActiveCallRoom(room)
      setError(null)
      if (!hasScreenCapture) {
        setError('Screen sharing APIs are unavailable in this runtime.')
        return
      }
      const nextScreen = !selfState.sharingScreen
      await room.localParticipant.setScreenShareEnabled(nextScreen)
      assertActiveCallRoom(room)
      await patchVoiceState({ sharingScreen: nextScreen })
    } catch (error) {
      if (isCallCancelled(error)) return
      try { assertActiveCallRoom(room) } catch { return }
      const message = error instanceof Error ? error.message : 'Could not toggle screen share.'
      setError(message)
    }
  }, [hasScreenCapture, patchVoiceState, room, selfState, setError])

  const onLeave = useCallback(async () => {
    setError(null)
    try {
      await onLeaveRoom()
    } catch (error) {
      const message = error instanceof Error ? error.message : leaveErrorMessage
      setError(message)
    }
  }, [leaveErrorMessage, onLeaveRoom, setError])

  return {
    onToggleMute,
    onToggleDeafen,
    onToggleCamera,
    onToggleScreenShare,
    onLeave,
  }
}
