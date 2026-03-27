import { useCallback } from 'react'
import type { RemoteParticipant, Room } from 'livekit-client'
import {
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
    setError(null)
    if (!room || !selfState) return
    try {
      const nextMuted = !selfState.muted
      if (!nextMuted) {
        await ensureMicrophoneCapture()
        if (audioInputId) {
          await switchRoomDevice(room, 'audioinput', audioInputId)
        }
      }
      await room.localParticipant.setMicrophoneEnabled(!nextMuted)
      await patchVoiceState({ muted: nextMuted })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not toggle microphone.'
      setError(message)
    }
  }, [audioInputId, ensureMicrophoneCapture, patchVoiceState, room, selfState, setError])

  const onToggleDeafen = useCallback(async () => {
    setError(null)
    if (!selfState) return
    try {
      const nextDeafened = !selfState.deafened
      for (const participant of remoteParticipants) {
        participant.setVolume(nextDeafened ? 0 : 1)
      }
      await patchVoiceState({ deafened: nextDeafened })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not toggle deafen.'
      setError(message)
    }
  }, [patchVoiceState, remoteParticipants, selfState, setError])

  const onToggleCamera = useCallback(async () => {
    setError(null)
    if (!room || !selfState) return
    try {
      const nextCamera = !selfState.sharingCamera
      await setLocalCameraEnabled(room, nextCamera, videoInputId ?? undefined)
      await patchVoiceState({ sharingCamera: nextCamera })
    } catch (error) {
      setError(getCameraErrorMessage(error))
    }
  }, [patchVoiceState, room, selfState, setError, videoInputId])

  const onToggleScreenShare = useCallback(async () => {
    setError(null)
    if (!room || !selfState) return
    if (!hasScreenCapture) {
      setError('Screen sharing APIs are unavailable in this runtime.')
      return
    }
    try {
      const nextScreen = !selfState.sharingScreen
      await room.localParticipant.setScreenShareEnabled(nextScreen)
      await patchVoiceState({ sharingScreen: nextScreen })
    } catch (error) {
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
