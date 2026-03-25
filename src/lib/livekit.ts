import { useMemo } from 'react'
import { Room } from 'livekit-client'
import { reducers } from './spacetimedb'
import { tauriCommands } from './tauri'
import { useConnectionStore } from '../stores/connectionStore'

export async function joinLiveKitVoice(channelId: number): Promise<Room> {
  await reducers.joinVoiceChannel(channelId)
  const room = new Room()
  const livekitUrl = await tauriCommands.getLivekitUrl()
  const identity = useConnectionStore.getState().identity
  if (!identity) {
    throw new Error('Cannot join voice: no local identity')
  }
  const token = await tauriCommands.generateLivekitToken(String(channelId), identity)
  await room.connect(livekitUrl, token)

  return room
}

export async function leaveLiveKitVoice(channelId: number, room: Room | null): Promise<void> {
  await reducers.leaveVoiceChannel(channelId)
  room?.disconnect()
}

export function useLiveKitRoom(room: Room | null) {
  return useMemo(
    () => ({
      room,
      localParticipant: room?.localParticipant ?? null,
      remoteParticipants: room ? Array.from(room.remoteParticipants.values()) : [],
      isSpeaking: false,
    }),
    [room],
  )
}
