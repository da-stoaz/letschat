import { useEffect, useState } from 'react'
import type { RoomConnectOptions, RoomOptions, VideoCaptureOptions } from 'livekit-client'
import { ConnectionState, Room, Track, createLocalVideoTrack } from 'livekit-client'
import { reducers } from './spacetimedb'
import { tauriCommands } from './tauri'
import { useConnectionStore } from '../stores/connectionStore'
import type { Identity } from '../types/domain'

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

export function getCameraUnavailableReason(): string {
  return `Camera APIs are unavailable in this runtime (${getMediaRuntimeSummary()}).`
}

export async function requestMicrophonePermission(): Promise<void> {
  if (!ensureMediaDevicesGetUserMedia()) {
    throw new Error(getMicrophoneUnavailableReason())
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  stream.getTracks().forEach((track) => track.stop())
}

export async function requestCameraPermission(): Promise<void> {
  if (!ensureMediaDevicesGetUserMedia()) {
    throw new Error(getCameraUnavailableReason())
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  stream.getTracks().forEach((track) => track.stop())
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    return String((error as { name: unknown }).name || '')
  }
  return ''
}

function isPermissionDeniedError(error: unknown): boolean {
  const name = errorName(error).toLowerCase()
  const message = errorMessage(error).toLowerCase()
  return (
    name === 'notallowederror' ||
    /permission denied|permission dismissed|not allowed/i.test(message)
  )
}

function isCameraConstraintError(error: unknown): boolean {
  const name = errorName(error).toLowerCase()
  const message = errorMessage(error).toLowerCase()
  return (
    name === 'overconstrainederror' ||
    /invalid constraint|overconstrained/i.test(message)
  )
}

function isCameraDeviceNotFoundError(error: unknown): boolean {
  const name = errorName(error).toLowerCase()
  const message = errorMessage(error).toLowerCase()
  return name === 'notfounderror' || /requested device not found|device not found|no device/i.test(message)
}

export function getCameraErrorMessage(error: unknown): string {
  if (!supportsMicrophoneCapture()) {
    return getCameraUnavailableReason()
  }
  if (isPermissionDeniedError(error)) {
    return 'Camera permission denied. Allow camera access and try again.'
  }
  if (isCameraDeviceNotFoundError(error)) {
    return 'No camera device is available (or the selected camera was disconnected).'
  }
  if (isCameraConstraintError(error)) {
    return 'Camera constraints were rejected by this runtime. Falling back to safer defaults did not succeed.'
  }
  return errorMessage(error) || 'Could not toggle camera.'
}

function normalizeLiveKitUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'ws://127.0.0.1:7880'

  let normalized = trimmed
  if (trimmed.startsWith('/')) {
    if (typeof window !== 'undefined') {
      normalized = `${window.location.origin}${trimmed}`
    } else {
      normalized = `http://127.0.0.1:7880${trimmed}`
    }
  } else if (trimmed.startsWith('//')) {
    const scheme = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:'
    normalized = `${scheme}${trimmed}`
  } else if (
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://') &&
    !trimmed.startsWith('ws://') &&
    !trimmed.startsWith('wss://')
  ) {
    normalized = `http://${trimmed}`
  }

  if (normalized.startsWith('ws://') || normalized.startsWith('wss://')) return normalized
  if (normalized.startsWith('http://')) return `ws://${normalized.slice('http://'.length)}`
  if (normalized.startsWith('https://')) return `wss://${normalized.slice('https://'.length)}`
  return normalized
}

function buildLiveKitUrls(raw: string): string[] {
  return [normalizeLiveKitUrl(raw)]
}

function normalizeIdentityKey(value: string): string {
  return value.trim().toLowerCase()
}

export function dmVoiceRoomKey(identityA: Identity, identityB: Identity): string {
  const a = normalizeIdentityKey(identityA)
  const b = normalizeIdentityKey(identityB)
  return a <= b ? `${a}:${b}` : `${b}:${a}`
}

type ConnectProfile = {
  roomOptions?: RoomOptions
  connectOptions?: RoomConnectOptions
}

const CONNECT_TIMEOUT_MS = 5_000
const CAMERA_TRACK_WAIT_MS = 1_500

function isLoopbackLivekitUrl(livekitUrl: string): boolean {
  try {
    const parsed = new URL(livekitUrl)
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1'
  } catch {
    return false
  }
}

function connectProfileForUrl(livekitUrl: string): ConnectProfile {
  const base: ConnectProfile = {
    connectOptions: {
      peerConnectionTimeout: CONNECT_TIMEOUT_MS,
      websocketTimeout: CONNECT_TIMEOUT_MS,
    },
  }

  if (!isLoopbackLivekitUrl(livekitUrl)) {
    return base
  }

  return {
    ...base,
    connectOptions: {
      ...base.connectOptions,
      rtcConfig: {
        // Local Docker development:
        // avoid srflx path selection (seen failing in logs), keep host/mDNS candidates.
        iceServers: [],
        iceTransportPolicy: 'all',
      },
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getPreferredVideoInputDeviceId(): Promise<string | undefined> {
  if (!ensureMediaDevicesGetUserMedia()) return undefined
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const videoInput = devices.find((device) => device.kind === 'videoinput' && device.deviceId)
    return videoInput?.deviceId || undefined
  } catch {
    return undefined
  }
}

async function getPreferredCameraCaptureOptions(): Promise<VideoCaptureOptions> {
  const preferredDeviceId = await getPreferredVideoInputDeviceId()
  return {
    ...(preferredDeviceId ? { deviceId: preferredDeviceId } : {}),
    resolution: { width: 1280, height: 720 },
    frameRate: 30,
  }
}

async function setCameraEnabledWithFallback(room: Room, options: Array<VideoCaptureOptions | undefined>): Promise<void> {
  let lastError: unknown = null
  for (const option of options) {
    try {
      if (option) {
        await room.localParticipant.setCameraEnabled(true, option)
      } else {
        await room.localParticipant.setCameraEnabled(true)
      }
      return
    } catch (error) {
      lastError = error
      // Retry for common cross-runtime camera failures.
      if (isCameraConstraintError(error) || isCameraDeviceNotFoundError(error)) {
        continue
      }
      throw error
    }
  }
  throw (lastError ?? new Error('Could not enable camera.'))
}

async function waitForLocalCameraTrack(room: Room, timeoutMs = CAMERA_TRACK_WAIT_MS): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const cameraPublication = room.localParticipant.getTrackPublication(Track.Source.Camera)
    if (cameraPublication?.videoTrack) {
      return true
    }
    await sleep(75)
  }
  return false
}

export async function setLocalCameraEnabled(room: Room, enabled: boolean): Promise<void> {
  if (!enabled) {
    await room.localParticipant.setCameraEnabled(false)
    return
  }

  await requestCameraPermission()
  const preferredCaptureOptions = await getPreferredCameraCaptureOptions()
  const safeCaptureOptions: VideoCaptureOptions = {
    resolution: { width: 640, height: 480 },
    frameRate: 24,
  }

  await setCameraEnabledWithFallback(room, [
    preferredCaptureOptions,
    safeCaptureOptions,
    undefined,
  ])

  if (await waitForLocalCameraTrack(room)) {
    return
  }

  let manualTrack: Awaited<ReturnType<typeof createLocalVideoTrack>> | null = null
  try {
    manualTrack = await createLocalVideoTrack(safeCaptureOptions)
  } catch (error) {
    if (!(isCameraConstraintError(error) || isCameraDeviceNotFoundError(error))) {
      throw error
    }
    manualTrack = await createLocalVideoTrack({})
  }

  try {
    await room.localParticipant.publishTrack(manualTrack, { source: Track.Source.Camera })
  } catch (error) {
    manualTrack.stop()
    throw error
  }

  if (!(await waitForLocalCameraTrack(room, 1_000))) {
    throw new Error('Camera was enabled, but no local camera track became available.')
  }
}

async function connectRoomWithFallback(livekitUrls: string[], token: string): Promise<Room> {
  let lastError: unknown = null
  for (const livekitUrl of livekitUrls) {
    const profile = connectProfileForUrl(livekitUrl)
    const room = new Room(profile.roomOptions)
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        room.connect(livekitUrl, token, profile.connectOptions),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`LiveKit connect timeout after ${CONNECT_TIMEOUT_MS}ms`))
          }, CONNECT_TIMEOUT_MS)
        }),
      ])
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      return room
    } catch (error) {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      lastError = error
      room.disconnect()
    }
  }
  throw (lastError ?? new Error('Failed to connect to LiveKit.'))
}

function mapLiveKitConnectionError(error: unknown, livekitUrls: string[]): Error {
  if (error instanceof Error && error.message.includes('Bad Configuration Parameters')) {
    return new Error(
      `LiveKit returned invalid ICE parameters for ${livekitUrls[0]}. Verify LiveKit config and restart the server.`,
    )
  }
  if (error instanceof Error && /(notallowederror|permission denied|permission dismissed)/i.test(error.message)) {
    return new Error('Microphone permission is required to join voice. Please allow microphone access and try again.')
  }
  if (error instanceof Error && /duplicate|restart participant/i.test(error.message)) {
    return new Error('This account is already in the same call from another client/session. Leave there first.')
  }
  if (error instanceof Error && error.message.toLowerCase().includes('connect timeout')) {
    return new Error(`LiveKit connect timed out at ${livekitUrls[0]}.`)
  }
  if (error instanceof Error && error.message.toLowerCase().includes('pc connection')) {
    return new Error(
      `Could not establish peer connection. Signal URL ${livekitUrls[0]} responded, but ICE failed. Verify LiveKit TCP 7881 and UDP 7882 mappings (plus UDP 7881 if enabled).`,
    )
  }
  return error instanceof Error ? error : new Error('Failed to connect to LiveKit.')
}

type ConnectLiveKitWithPresenceParams = {
  roomName: string
  identityErrorMessage: string
  permissionDeniedWarning: string
  micEnableWarning: string
  onJoinPresence: () => Promise<void>
  onLeavePresence: () => Promise<void>
  onSyncMutedState: (muted: boolean) => Promise<void>
}

async function connectLiveKitWithPresence(params: ConnectLiveKitWithPresenceParams): Promise<Room> {
  const rawLivekitUrl = await tauriCommands.getLivekitUrl()
  const livekitUrls = buildLiveKitUrls(rawLivekitUrl)
  const identity = useConnectionStore.getState().identity
  if (!identity) {
    throw new Error(params.identityErrorMessage)
  }

  let room: Room | null = null
  await params.onJoinPresence()
  try {
    const token = await tauriCommands.generateLivekitToken(params.roomName, identity)
    room = await connectRoomWithFallback(livekitUrls, token)
  } catch (error) {
    await params.onLeavePresence().catch(() => undefined)
    room?.disconnect()
    throw mapLiveKitConnectionError(error, livekitUrls)
  }

  if (!room) {
    await params.onLeavePresence().catch(() => undefined)
    throw new Error('LiveKit room was not established.')
  }

  if (!supportsMicrophoneCapture()) {
    await params.onSyncMutedState(true).catch(() => undefined)
    return room
  }

  try {
    await requestMicrophonePermission()
    await room.localParticipant.setMicrophoneEnabled(true)
    await params.onSyncMutedState(false).catch(() => undefined)
  } catch (error) {
    await params.onSyncMutedState(true).catch(() => undefined)
    if (error instanceof Error && /(notallowederror|permission denied|permission dismissed)/i.test(error.message)) {
      console.warn(params.permissionDeniedWarning)
      return room
    }
    console.warn(params.micEnableWarning, error)
  }

  return room
}

export async function joinLiveKitVoice(channelId: number): Promise<Room> {
  return connectLiveKitWithPresence({
    roomName: String(channelId),
    identityErrorMessage: 'Cannot join voice: no local identity',
    permissionDeniedWarning: 'Microphone permission denied; joined voice in listen-only mode.',
    micEnableWarning: 'Could not enable microphone automatically; joined voice in listen-only mode.',
    onJoinPresence: () => reducers.joinVoiceChannel(channelId),
    onLeavePresence: () => reducers.leaveVoiceChannel(channelId),
    onSyncMutedState: (muted) => reducers.updateVoiceState(channelId, muted, false, false, false),
  })
}

export async function joinLiveKitDmVoice(partnerIdentity: Identity): Promise<Room> {
  const identity = useConnectionStore.getState().identity
  if (!identity) {
    throw new Error('Cannot join DM voice: no local identity')
  }
  const roomName = `dm:${dmVoiceRoomKey(identity, partnerIdentity)}`
  return connectLiveKitWithPresence({
    roomName,
    identityErrorMessage: 'Cannot join DM voice: no local identity',
    permissionDeniedWarning: 'Microphone permission denied; joined DM voice in listen-only mode.',
    micEnableWarning: 'Could not enable microphone automatically; joined DM voice in listen-only mode.',
    onJoinPresence: () => reducers.joinDmVoice(partnerIdentity),
    onLeavePresence: () => reducers.leaveDmVoice(partnerIdentity),
    onSyncMutedState: (muted) => reducers.updateDmVoiceState(partnerIdentity, muted, false, false, false),
  })
}

export async function leaveLiveKitVoice(channelId: number, room: Room | null): Promise<void> {
  await reducers.leaveVoiceChannel(channelId)
  room?.disconnect()
}

export async function leaveLiveKitDmVoice(partnerIdentity: Identity, room: Room | null): Promise<void> {
  await reducers.leaveDmVoice(partnerIdentity)
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
    room.on('trackPublished', bump)
    room.on('trackUnpublished', bump)
    room.on('trackSubscribed', bump)
    room.on('trackUnsubscribed', bump)
    room.on('trackMuted', bump)
    room.on('trackUnmuted', bump)
    room.on('localTrackPublished', bump)
    room.on('localTrackUnpublished', bump)

    return () => {
      room.off('participantConnected', onParticipantEvent)
      room.off('participantDisconnected', onParticipantEvent)
      room.off('activeSpeakersChanged', bump)
      room.off('connectionStateChanged', bump)
      room.off('trackPublished', bump)
      room.off('trackUnpublished', bump)
      room.off('trackSubscribed', bump)
      room.off('trackUnsubscribed', bump)
      room.off('trackMuted', bump)
      room.off('trackUnmuted', bump)
      room.off('localTrackPublished', bump)
      room.off('localTrackUnpublished', bump)
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
