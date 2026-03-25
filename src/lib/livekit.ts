import { useEffect, useState } from 'react'
import { ConnectionState, Room } from 'livekit-client'
import { reducers } from './spacetimedb'
import { tauriCommands } from './tauri'
import { useConnectionStore } from '../stores/connectionStore'

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  onSuccess: (stream: MediaStream) => void,
  onError: (error: unknown) => void,
) => void

type NavigatorWithLegacyMedia = Navigator & {
  mediaDevices?: MediaDevices
  webkitGetUserMedia?: LegacyGetUserMedia
  mozGetUserMedia?: LegacyGetUserMedia
  getUserMedia?: LegacyGetUserMedia
}

function getNavigator(): NavigatorWithLegacyMedia | null {
  if (typeof navigator === 'undefined') return null
  return navigator as NavigatorWithLegacyMedia
}

function getLegacyGetUserMedia(nav: NavigatorWithLegacyMedia): LegacyGetUserMedia | null {
  return nav.webkitGetUserMedia ?? nav.mozGetUserMedia ?? nav.getUserMedia ?? null
}

function ensureMediaDevicesGetUserMedia(): boolean {
  const nav = getNavigator()
  if (!nav) return false
  if (typeof nav.mediaDevices?.getUserMedia === 'function') return true

  const legacyGetUserMedia = getLegacyGetUserMedia(nav)
  if (!legacyGetUserMedia) return false

  const mediaDevices = nav.mediaDevices ?? ({} as MediaDevices)
  const mutableMediaDevices = mediaDevices as MediaDevices & {
    getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  }

  if (typeof mutableMediaDevices.getUserMedia !== 'function') {
    mutableMediaDevices.getUserMedia = (constraints: MediaStreamConstraints) =>
      new Promise<MediaStream>((resolve, reject) => {
        legacyGetUserMedia.call(nav, constraints, resolve, reject)
      })
  }

  if (!nav.mediaDevices) {
    try {
      Object.defineProperty(nav, 'mediaDevices', {
        configurable: true,
        enumerable: true,
        value: mediaDevices,
      })
    } catch {
      ;(nav as { mediaDevices?: MediaDevices }).mediaDevices = mediaDevices
    }
  }

  return typeof nav.mediaDevices?.getUserMedia === 'function'
}

function getMediaRuntimeSummary(): string {
  const nav = getNavigator()
  const origin = typeof window === 'undefined' ? 'unknown' : window.location.href
  const secureContext = typeof window !== 'undefined' && window.isSecureContext
  const hasMediaDevices = Boolean(nav?.mediaDevices)
  const hasGetUserMedia = typeof nav?.mediaDevices?.getUserMedia === 'function'
  const hasLegacyGetUserMedia = nav ? Boolean(getLegacyGetUserMedia(nav)) : false
  return `origin=${origin}, secureContext=${secureContext}, mediaDevices=${hasMediaDevices}, getUserMedia=${hasGetUserMedia}, legacyGetUserMedia=${hasLegacyGetUserMedia}`
}

export function supportsMicrophoneCapture(): boolean {
  return ensureMediaDevicesGetUserMedia()
}

export function supportsScreenCapture(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

export function getMicrophoneUnavailableReason(): string {
  return `Microphone APIs are unavailable in this runtime (${getMediaRuntimeSummary()}).`
}

export async function requestMicrophonePermission(): Promise<void> {
  if (!ensureMediaDevicesGetUserMedia()) {
    throw new Error(getMicrophoneUnavailableReason())
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  stream.getTracks().forEach((track) => track.stop())
}

function normalizeLiveKitUrl(raw: string): string {
  const normalized = raw.trim()
  if (normalized.startsWith('ws://') || normalized.startsWith('wss://')) return normalized
  if (normalized.startsWith('http://')) return `ws://${normalized.slice('http://'.length)}`
  if (normalized.startsWith('https://')) return `wss://${normalized.slice('https://'.length)}`
  return `ws://${normalized}`
}

export async function joinLiveKitVoice(channelId: number): Promise<Room> {
  const room = new Room()
  const rawLivekitUrl = await tauriCommands.getLivekitUrl()
  const livekitUrl = normalizeLiveKitUrl(rawLivekitUrl)
  const identity = useConnectionStore.getState().identity
  if (!identity) {
    throw new Error('Cannot join voice: no local identity')
  }

  await reducers.joinVoiceChannel(channelId)
  try {
    const token = await tauriCommands.generateLivekitToken(String(channelId), identity)
    await room.connect(livekitUrl, token)
  } catch (error) {
    await reducers.leaveVoiceChannel(channelId).catch(() => undefined)
    room.disconnect()
    if (error instanceof Error && error.message.includes('Bad Configuration Parameters')) {
      throw new Error('LiveKit returned invalid ICE parameters. Verify LiveKit config and restart the server.')
    }
    if (error instanceof Error && /(notallowederror|permission denied|permission dismissed)/i.test(error.message)) {
      throw new Error('Microphone permission is required to join voice. Please allow microphone access and try again.')
    }
    if (error instanceof Error && error.message.toLowerCase().includes('pc connection')) {
      throw new Error(
        'Could not establish peer connection. Check LiveKit URL/ports (7880 + UDP 7881) and try again.',
      )
    }
    throw error
  }

  if (!supportsMicrophoneCapture()) {
    await reducers.updateVoiceState(channelId, true, false, false, false).catch(() => undefined)
    return room
  }

  try {
    await requestMicrophonePermission()
    await room.localParticipant.setMicrophoneEnabled(true)
    await reducers.updateVoiceState(channelId, false, false, false, false).catch(() => undefined)
  } catch (error) {
    await reducers.updateVoiceState(channelId, true, false, false, false).catch(() => undefined)
    if (error instanceof Error && /(notallowederror|permission denied|permission dismissed)/i.test(error.message)) {
      console.warn('Microphone permission denied; joined voice in listen-only mode.')
      return room
    }
    console.warn('Could not enable microphone automatically; joined voice in listen-only mode.', error)
  }

  return room
}

export async function leaveLiveKitVoice(channelId: number, room: Room | null): Promise<void> {
  await reducers.leaveVoiceChannel(channelId)
  room?.disconnect()
}

export function useLiveKitRoom(room: Room | null) {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!room) return

    const bump = () => setVersion((v) => v + 1)
    const onParticipantEvent = () => bump()
    room.on('participantConnected', onParticipantEvent)
    room.on('participantDisconnected', onParticipantEvent)
    room.on('activeSpeakersChanged', bump)
    room.on('connectionStateChanged', bump)

    return () => {
      room.off('participantConnected', onParticipantEvent)
      room.off('participantDisconnected', onParticipantEvent)
      room.off('activeSpeakersChanged', bump)
      room.off('connectionStateChanged', bump)
    }
  }, [room])

  // Access version to force recomputation when LiveKit emits tracked events.
  void version

  return {
    room,
    localParticipant: room?.localParticipant ?? null,
    remoteParticipants: room ? Array.from(room.remoteParticipants.values()) : [],
    activeSpeakerIds: new Set((room?.activeSpeakers ?? []).map((p) => p.identity)),
    connectionState: room?.state ?? ConnectionState.Disconnected,
  }
}
