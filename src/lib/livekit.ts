import { useEffect, useState } from 'react'
import type { RoomConnectOptions, RoomOptions, VideoCaptureOptions } from 'livekit-client'
import { ConnectionState, Room, Track } from 'livekit-client'
import { reducers } from './spacetimedb'
import { tauriCommands } from './tauri'
import { useConnectionStore } from '../stores/connectionStore'
import { useVoiceSessionStore } from '../stores/voiceSessionStore'
import { useDmVoiceSessionStore } from '../stores/dmVoiceSessionStore'
import { useServerConfigStore } from '../stores/serverConfigStore'
import { useVoiceStore } from '../stores/voiceStore'
import { useDmVoiceStore } from '../stores/dmVoiceStore'
import { clearCallReload, saveCallReload, takeCallReload, type CallTarget, type CallAudioState } from '../features/voice/callReload'
import { toast } from 'sonner'
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

export type LivekitDeviceKind = 'audioinput' | 'videoinput' | 'audiooutput'

export interface LivekitDeviceOption {
  deviceId: string
  kind: LivekitDeviceKind
  label: string
}

type SinkCapableElement = HTMLMediaElement & {
  setSinkId: (sinkId: string) => Promise<void>
}

type ConnectProfile = {
  roomOptions?: RoomOptions
  connectOptions?: RoomConnectOptions
}

// Budget for the whole LiveKit connect: WebSocket, then ICE, then DTLS. 5s was far
// too tight — ICE alone routinely needs longer than that on a first connection,
// notably through Docker Desktop's userspace UDP proxy in local dev, so the client
// hung up mid-negotiation every time and reported a generic timeout. This matches
// the SDK's own 15s default for peerConnectionTimeout / websocketTimeout.
const CONNECT_TIMEOUT_MS = 15_000

// The outer guard only exists to catch a connect() that never settles at all, so it
// must sit ABOVE the SDK's own timeouts. Racing at the same value wins the race and
// replaces the SDK's specific failure ("could not establish pc connection") with an
// unhelpful "connect timed out", which is exactly what masked the cause here.
const CONNECT_WATCHDOG_MS = CONNECT_TIMEOUT_MS + 5_000
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

function fallbackDeviceLabel(kind: LivekitDeviceKind, index: number): string {
  if (kind === 'audioinput') return `Microphone ${index + 1}`
  if (kind === 'audiooutput') return `Speaker ${index + 1}`
  return `Camera ${index + 1}`
}

export async function listLivekitDevices(
  kind: LivekitDeviceKind,
  requestPermissions = false,
): Promise<LivekitDeviceOption[]> {
  try {
    const devices = await Room.getLocalDevices(kind, requestPermissions)
    return devices
      .filter((device) => Boolean(device.deviceId))
      .map((device, index) => ({
        deviceId: device.deviceId,
        kind,
        label: device.label || fallbackDeviceLabel(kind, index),
      }))
  } catch {
    return []
  }
}

export async function switchRoomDevice(
  room: Room,
  kind: LivekitDeviceKind,
  deviceId: string,
): Promise<string> {
  if (kind !== 'audiooutput') {
    await room.switchActiveDevice(kind, deviceId, false)
    // For input devices, some runtimes keep reporting "default" even after a
    // successful switch. Return the explicit selection so UI state stays in sync.
    return deviceId
  }

  // LiveKit refuses `audiooutput` on Safari-based engines by USER AGENT, not by
  // capability: its `supportsSetSinkId()` returns false for `isSafariBased()`
  // before it ever looks at an element. WKWebView does implement
  // `HTMLMediaElement.setSinkId`, and this app attaches its own `<audio>` sinks
  // (`CallAudioRenderer`), so that refusal is advice we can decline — the sinks
  // are moved below by hand.
  //
  // Letting the throw escape was the whole bug: the selection was reverted and
  // an error shown while the mechanism that actually works never got to run.
  // Anything that is not that specific refusal is still a real failure.
  let livekitAccepted = false
  try {
    await room.switchActiveDevice(kind, deviceId, false)
    livekitAccepted = true
  } catch (error) {
    const message = errorMessage(error)
    if (!/cannot switch audio output/i.test(message)) {
      throw error
    }
  }

  const sinkId = (livekitAccepted ? room.getActiveDevice('audiooutput') : null) ?? deviceId

  // Counted, so the caller can tell "moved it" from "could not move it" instead
  // of every failure being swallowed and reported as success.
  let attempted = 0
  let applied = 0

  const applySink = async (target: { setSinkId?: (id: string) => Promise<void> } | null) => {
    if (typeof target?.setSinkId !== 'function') return
    attempted += 1
    try {
      await target.setSinkId(sinkId)
      applied += 1
    } catch {
      // Counted as attempted-but-failed; reported once at the end.
    }
  }

  // Reinforce sink changes for already-attached remote tracks/elements.
  await Promise.all(
    Array.from(room.remoteParticipants.values()).map(async (participant) => {
      try {
        await participant.setAudioOutput({ deviceId: sinkId })
      } catch {
        // Best-effort: LiveKit gates this the same way, so the manual path below
        // is what actually carries the change on WebKit.
      }

      await Promise.all(
        Array.from(participant.audioTrackPublications.values()).map((publication) =>
          applySink(publication.audioTrack as { setSinkId?: (id: string) => Promise<void> } | null),
        ),
      )
    }),
  )

  if (typeof document !== 'undefined') {
    const audioElements = Array.from(
      document.querySelectorAll<HTMLAudioElement>('audio[data-letschat-audio="remote"]'),
    )
    await Promise.all(audioElements.map((element) => applySink(element as SinkCapableElement)))
  }

  // Nothing attached yet (alone in the call, or nobody unmuted) is not a
  // failure: `CallAudioRenderer` applies the stored device to every sink it
  // mounts, so the choice takes effect as soon as there is audio to move.
  // Every attempt failing is a failure, and used to be reported as success.
  if (attempted > 0 && applied === 0) {
    throw new Error('That output device would not accept the call audio.')
  }

  return sinkId
}

async function getAvailableVideoInputDeviceIds(): Promise<string[]> {
  if (!ensureMediaDevicesGetUserMedia()) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'videoinput' && Boolean(device.deviceId))
      .map((device) => device.deviceId)
  } catch {
    return []
  }
}

async function setCameraEnabledWithFallback(room: Room, options: Array<VideoCaptureOptions | undefined>): Promise<void> {
  let lastError: unknown = null
  for (const option of options) {
    try {
      assertActiveCallRoom(room)
      if (option) {
        await room.localParticipant.setCameraEnabled(true, option)
      } else {
        await room.localParticipant.setCameraEnabled(true)
      }
      assertActiveCallRoom(room)
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

async function getUserMediaCameraTrackWithFallback(room: Room, preferredDeviceId?: string): Promise<MediaStreamTrack> {
  if (!ensureMediaDevicesGetUserMedia()) {
    throw new Error(getCameraUnavailableReason())
  }

  const knownVideoDeviceIds = await getAvailableVideoInputDeviceIds()
  const deviceAttempts: string[] = []
  if (preferredDeviceId) {
    deviceAttempts.push(preferredDeviceId)
  }
  for (const deviceId of knownVideoDeviceIds) {
    if (!deviceAttempts.includes(deviceId)) {
      deviceAttempts.push(deviceId)
    }
  }

  const attempts: Array<MediaTrackConstraints | boolean> = []
  for (const deviceId of deviceAttempts) {
    attempts.push({
      deviceId: { exact: deviceId },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    })
  }
  attempts.push(
    {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
    {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 24 },
    },
    true,
  )

  let lastError: unknown = null
  for (const video of attempts) {
    try {
      assertActiveCallRoom(room)
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false })
      try {
        assertActiveCallRoom(room)
      } catch (error) {
        stream.getTracks().forEach(track => track.stop())
        throw error
      }
      const [track, ...extraTracks] = stream.getVideoTracks()
      if (!track) {
        stream.getTracks().forEach((t) => t.stop())
        continue
      }
      extraTracks.forEach((t) => t.stop())
      for (const audioTrack of stream.getAudioTracks()) {
        audioTrack.stop()
      }
      return track
    } catch (error) {
      if (isCallCancelled(error)) throw error
      lastError = error
    }
  }

  throw (lastError ?? new Error('Could not acquire a camera track.'))
}

async function publishManualCameraTrack(room: Room, preferredDeviceId?: string): Promise<void> {
  const manualTrack = await getUserMediaCameraTrackWithFallback(room, preferredDeviceId)

  try {
    assertActiveCallRoom(room)
    const existingPublication = room.localParticipant.getTrackPublication(Track.Source.Camera)
    if (existingPublication?.track) {
      await room.localParticipant.unpublishTrack(existingPublication.track, true)
      assertActiveCallRoom(room)
    }
    await room.localParticipant.publishTrack(manualTrack, { source: Track.Source.Camera })
    assertActiveCallRoom(room)
  } catch (error) {
    manualTrack.stop()
    throw error
  }
}

async function waitForLocalCameraTrack(room: Room, timeoutMs = CAMERA_TRACK_WAIT_MS): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    assertActiveCallRoom(room)
    const cameraPublication = room.localParticipant.getTrackPublication(Track.Source.Camera)
    if (cameraPublication?.videoTrack) {
      return true
    }
    await sleep(75)
  }
  return false
}

export async function setLocalCameraEnabled(
  room: Room,
  enabled: boolean,
  preferredDeviceId?: string,
): Promise<void> {
  assertActiveCallRoom(room)
  if (!enabled) {
    await room.localParticipant.setCameraEnabled(false)
    return
  }

  const effectivePreferredDeviceId = preferredDeviceId ?? (await getPreferredVideoInputDeviceId())
  assertActiveCallRoom(room)
  if (effectivePreferredDeviceId) {
    try {
      await switchRoomDevice(room, 'videoinput', effectivePreferredDeviceId)
    } catch (error) {
      if (isCallCancelled(error)) throw error
      // Continue with fallback capture attempts if runtime rejects an explicit device switch.
    }
  }

  const safeCaptureOptions: VideoCaptureOptions = {
    resolution: { width: 640, height: 480 },
    frameRate: 24,
  }

  let primaryEnableError: unknown = null
  try {
    await setCameraEnabledWithFallback(room, [
      undefined,
      safeCaptureOptions,
    ])
  } catch (error) {
    if (isCallCancelled(error)) throw error
    primaryEnableError = error
  }

  if (await waitForLocalCameraTrack(room)) {
    return
  }

  try {
    await publishManualCameraTrack(room, effectivePreferredDeviceId)
  } catch (error) {
    if (primaryEnableError) {
      throw primaryEnableError
    }
    throw error
  }

  if (!(await waitForLocalCameraTrack(room, 1_000))) {
    throw new Error('Camera was enabled, but no local camera track became available.')
  }
}

async function connectRoomWithFallback(
  livekitUrls: string[], token: string, attempt: CallAttempt,
): Promise<Room> {
  let lastError: unknown = null
  for (const livekitUrl of livekitUrls) {
    assertCurrentCall(attempt)
    const profile = connectProfileForUrl(livekitUrl)
    const room = new Room(profile.roomOptions)
    attempt.room = room
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    try {
      await waitForCallStep(attempt, Promise.race([
        room.connect(livekitUrl, token, profile.connectOptions).then(() => {
          // Some runtimes finish connect after disconnect was requested.
          try { assertCurrentCall(attempt) } catch (error) { stopRoom(room); throw error }
        }),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`LiveKit connect timeout after ${CONNECT_WATCHDOG_MS}ms`))
          }, CONNECT_WATCHDOG_MS)
        }),
      ]))
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      assertCurrentCall(attempt)
      return room
    } catch (error) {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      lastError = error
      stopRoom(room)
      if (isCallCancelled(error)) throw error
    }
  }
  throw (lastError ?? new Error('Failed to connect to LiveKit.'))
}

function mapLiveKitConnectionError(error: unknown, livekitUrls: string[]): Error {
  // The messages below are for humans and deliberately drop detail. Keep the
  // original on the console and as `cause` — without it a connection failure is
  // undiagnosable, because the friendly text is all anyone ever sees.
  console.error('[livekit] connect failed', { url: livekitUrls[0], error })
  if (error instanceof Error && error.message.includes('Bad Configuration Parameters')) {
    return new Error(
      `LiveKit returned invalid ICE parameters for ${livekitUrls[0]}. Verify LiveKit config and restart the server.`,
      { cause: error },
    )
  }
  if (error instanceof Error && /(notallowederror|permission denied|permission dismissed)/i.test(error.message)) {
    return new Error('Microphone permission is required to join voice. Please allow microphone access and try again.')
  }
  if (error instanceof Error && /duplicate|restart participant/i.test(error.message)) {
    return new Error('This account is already in the same call from another client/session. Leave there first.')
  }
  if (error instanceof Error && error.message.toLowerCase().includes('connect timeout')) {
    return new Error(`LiveKit connect timed out at ${livekitUrls[0]}.`, { cause: error })
  }
  if (error instanceof Error && error.message.toLowerCase().includes('pc connection')) {
    return new Error(
      `Could not establish the call's media connection. Signalling at ${livekitUrls[0]} responded, but ICE failed.`,
      { cause: error },
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
  initiallyMuted: boolean
}

type CallAttempt = {
  target: CallTarget
  identity: Identity
  epoch: number
  params: ConnectLiveKitWithPresenceParams
  room: Room | null
  claimedPresence: boolean
  cancellation: AbortController
}

let activeCall: CallAttempt | null = null
let callEpoch = 0
let callWork: Promise<unknown> = Promise.resolve()
const pendingLeaves = new Set<CallAttempt>()
const CLEANUP_TOAST_ID = 'call-presence-cleanup'

function queueCallWork<T>(work: () => Promise<T>): Promise<T> {
  const result = callWork.then(work)
  callWork = result.catch(() => undefined)
  return result
}

export function isCallCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function assertCurrentCall(attempt: CallAttempt): void {
  if (activeCall !== attempt || attempt.epoch !== callEpoch ||
    attempt.identity !== useConnectionStore.getState().identity) {
    throw new DOMException('Call cancelled.', 'AbortError')
  }
}

async function waitForCallStep<T>(attempt: CallAttempt, step: Promise<T>): Promise<T> {
  let onCancel!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    onCancel = () => reject(new DOMException('Call cancelled.', 'AbortError'))
    attempt.cancellation.signal.addEventListener('abort', onCancel, { once: true })
    if (attempt.cancellation.signal.aborted) onCancel()
  })
  try {
    return await Promise.race([step, cancelled])
  } finally {
    attempt.cancellation.signal.removeEventListener('abort', onCancel)
  }
}

function sameCall(left: CallTarget, right: CallTarget): boolean {
  return left.kind === right.kind && String(left.id).toLowerCase() === String(right.id).toLowerCase()
}

function stopRoom(room: Room | null): void {
  if (!room) return
  // Stop capture synchronously: disconnect() and server cleanup can both await I/O.
  for (const publication of room.localParticipant.trackPublications.values()) {
    publication.track?.stop()
  }
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.audioTrackPublications.values()) {
      for (const element of publication.audioTrack?.detach() ?? []) {
        element.pause()
        element.srcObject = null
      }
    }
  }
  void room.disconnect().catch(error => console.error('[livekit] disconnect failed', error))
}

function clearLocalCalls(): CallAttempt | null {
  const previous = activeCall
  activeCall = null
  previous?.cancellation.abort()
  const rooms = new Set([previous?.room, useVoiceSessionStore.getState().room, useDmVoiceSessionStore.getState().room])
  // Clear ownership before disconnect emits events; intentional leave has one cleanup owner.
  useVoiceSessionStore.getState().reset()
  useDmVoiceSessionStore.getState().reset()
  for (const room of rooms) stopRoom(room ?? null)
  return previous
}

/** Sign-out invalidates in-flight joins as well as already connected rooms. */
export function resetCallSessions(): void {
  clearCallReload()
  callEpoch++
  clearLocalCalls()
  pendingLeaves.clear()
  toast.dismiss(CLEANUP_TOAST_ID)
}

/** Snapshot before the SDK's unload handler disconnects the room. */
export function prepareCallReload(): void {
  const attempt = activeCall
  const config = useServerConfigStore.getState().config
  if (!attempt?.room || attempt.room.state === ConnectionState.Disconnected || !config) return
  const installedRoom = attempt.target.kind === 'channel' ? useVoiceSessionStore.getState().room : useDmVoiceSessionStore.getState().room
  if (installedRoom !== attempt.room) return
  const participants = attempt.target.kind === 'channel'
    ? useVoiceStore.getState().participantsByChannel[attempt.target.id]
    : useDmVoiceStore.getState().participantsByRoom[dmVoiceRoomKey(attempt.identity, attempt.target.id)]
  const self = participants?.find(participant => normalizeIdentityKey(participant.userIdentity) === normalizeIdentityKey(attempt.identity))
  saveCallReload(attempt.target, {
    muted: !attempt.room.localParticipant.isMicrophoneEnabled,
    deafened: self?.deafened ?? false,
  }, attempt.identity, config)
  // Clear ownership before disconnect events fire. The old database socket's
  // server-side disconnect cleanup removes only its own presence rows.
  clearLocalCalls()
}

export async function restoreCallAfterReload(): Promise<void> {
  const { identity } = useConnectionStore.getState()
  const config = useServerConfigStore.getState().config
  if (!identity || !config) return
  const saved = takeCallReload(identity, config)
  if (!saved || activeCall) return
  try {
    if (saved.target.kind === 'channel') await joinLiveKitVoice(saved.target.id, saved)
    else await joinLiveKitDmVoice(saved.target.id, saved)
  } catch (error) {
    if (!isCallCancelled(error)) toast.error('Could not rejoin the call after reload. Join the call again to retry.')
  }
}

async function releasePresence(attempt: CallAttempt): Promise<void> {
  if (!attempt.claimedPresence || attempt.epoch !== callEpoch ||
    attempt.identity !== useConnectionStore.getState().identity) return
  // A retry from an older call must never remove a newer call's presence.
  if (activeCall !== attempt && activeCall?.claimedPresence && sameCall(activeCall.target, attempt.target)) {
    pendingLeaves.delete(attempt)
    attempt.claimedPresence = false
    if (!pendingLeaves.size) toast.dismiss(CLEANUP_TOAST_ID)
    return
  }
  try {
    await attempt.params.onLeavePresence()
    attempt.claimedPresence = false
    pendingLeaves.delete(attempt)
    if (!pendingLeaves.size) toast.dismiss(CLEANUP_TOAST_ID)
  } catch (error) {
    if (attempt.epoch !== callEpoch || attempt.identity !== useConnectionStore.getState().identity) return
    pendingLeaves.add(attempt)
    toast.error('Call ended on this device. Server cleanup is pending.', {
      id: CLEANUP_TOAST_ID,
      duration: Infinity,
      action: { label: 'Retry', onClick: () => { void retryCallCleanup() } },
    })
    console.warn('[livekit] could not release call presence', error)
  }
}

/** Retry after reconnect or an explicit user action; local media is already stopped. */
export function retryCallCleanup(): Promise<void> {
  return queueCallWork(async () => {
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- Presence writes share the serialized call queue so a late leave cannot delete a newer join.
    for (const attempt of pendingLeaves) await releasePresence(attempt)
  })
}

function startCall(target: CallTarget, params: ConnectLiveKitWithPresenceParams): Promise<Room> {
  clearCallReload()
  const identity = useConnectionStore.getState().identity
  if (!identity) return Promise.reject(new Error(params.identityErrorMessage))
  const installedRoom = target.kind === 'channel' ? useVoiceSessionStore.getState().room : useDmVoiceSessionStore.getState().room
  if (activeCall && sameCall(activeCall.target, target) && installedRoom === activeCall.room && activeCall.room?.state === ConnectionState.Connected) {
    return Promise.resolve(activeCall.room)
  }
  const previous = clearLocalCalls()
  const attempt: CallAttempt = {
    target, params, identity, epoch: callEpoch, room: null, claimedPresence: false,
    cancellation: new AbortController(),
  }
  activeCall = attempt
  if (target.kind === 'channel') {
    useVoiceSessionStore.setState({ joinedChannelId: target.id, joining: true })
  } else {
    useDmVoiceSessionStore.setState({ joinedPartnerIdentity: target.id, joining: true })
  }
  // Serializing presence writes prevents a late leave from deleting a newer join.
  return queueCallWork(async () => {
    if (previous) await releasePresence(previous)
    try {
      assertCurrentCall(attempt)
      const room = await connectLiveKitWithPresence(params, attempt)
      assertCurrentCall(attempt)
      if (target.kind === 'channel') useVoiceSessionStore.setState({ room, joining: false })
      else useDmVoiceSessionStore.setState({ room, joining: false, answered: false })
      return room
    } catch (error) {
      stopRoom(attempt.room)
      await releasePresence(attempt)
      assertCurrentCall(attempt)
      clearLocalCalls()
      const message = error instanceof Error ? error.message : 'Could not join call.'
      if (target.kind === 'channel') useVoiceSessionStore.getState().setError(message)
      else useDmVoiceSessionStore.getState().setError(message)
      throw error
    }
  })
}

function endCall(target: CallTarget, room: Room | null): Promise<void> {
  // Ignore stale view handlers after switching calls, including rejoining the same room.
  if (!activeCall || !sameCall(activeCall.target, target) || (room && activeCall.room !== room)) {
    stopRoom(room)
    return Promise.resolve()
  }
  clearCallReload()
  const previous = clearLocalCalls()!
  return queueCallWork(() => releasePresence(previous))
}

/** Media controls can finish after hang-up or a call switch. Never publish into that old room. */
export function assertActiveCallRoom(room: Room): void {
  if (!activeCall || activeCall.room !== room) {
    stopRoom(room)
    throw new DOMException('Call cancelled.', 'AbortError')
  }
  assertCurrentCall(activeCall)
}

async function connectLiveKitWithPresence(params: ConnectLiveKitWithPresenceParams, attempt: CallAttempt): Promise<Room> {
  const rawLivekitUrl = await waitForCallStep(attempt, tauriCommands.getLivekitUrl())
  const livekitUrls = buildLiveKitUrls(rawLivekitUrl)
  assertCurrentCall(attempt)

  // Presence MUST be claimed before minting the token: core-api authorises the
  // token against the SpacetimeDB presence row (LiveKitEndpoints.IssueToken ->
  // HasVoicePresenceAsync) so that nobody can mint a token for a room they
  // never joined. Minting first returns 403 "You are not a participant in this
  // voice room." — do not reorder these.
  try {
    await params.onJoinPresence()
    attempt.claimedPresence = true
    assertCurrentCall(attempt)
    for (const previous of pendingLeaves) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- Clear obsolete ownership in order before minting the new call's token.
      if (sameCall(previous.target, attempt.target)) await releasePresence(previous)
    }
    const token = await waitForCallStep(attempt, tauriCommands.generateLivekitToken(params.roomName, attempt.identity))
    assertCurrentCall(attempt)
    attempt.room = await connectRoomWithFallback(livekitUrls, token, attempt)
  } catch (error) {
    if (isCallCancelled(error)) throw error
    throw mapLiveKitConnectionError(error, livekitUrls)
  }
  const room = attempt.room
  assertCurrentCall(attempt)

  if (params.initiallyMuted || !supportsMicrophoneCapture()) {
    await params.onSyncMutedState(true).catch(() => undefined)
    assertCurrentCall(attempt)
    return room
  }

  try {
    // A dismissed/ignored browser prompt must not block the next call. The
    // permission helper still stops any stream it eventually receives.
    await waitForCallStep(attempt, requestMicrophonePermission())
    assertCurrentCall(attempt)
    await room.localParticipant.setMicrophoneEnabled(true)
    assertCurrentCall(attempt)
    await params.onSyncMutedState(false).catch(() => undefined)
  } catch (error) {
    if (isCallCancelled(error)) throw error
    await params.onSyncMutedState(true).catch(() => undefined)
    if (error instanceof Error && /(notallowederror|permission denied|permission dismissed)/i.test(error.message)) {
      console.warn(params.permissionDeniedWarning)
      assertCurrentCall(attempt)
      return room
    }
    console.warn(params.micEnableWarning, error)
  }

  assertCurrentCall(attempt)
  return room
}

export async function joinLiveKitVoice(channelId: number, audio: CallAudioState = { muted: false, deafened: false }): Promise<Room> {
  return startCall({ kind: 'channel', id: channelId }, {
    roomName: String(channelId),
    identityErrorMessage: 'Cannot join voice: no local identity',
    permissionDeniedWarning: 'Microphone permission denied; joined voice in listen-only mode.',
    micEnableWarning: 'Could not enable microphone automatically; joined voice in listen-only mode.',
    onJoinPresence: () => reducers.joinVoiceChannel(channelId),
    onLeavePresence: () => reducers.leaveVoiceChannel(channelId),
    onSyncMutedState: (muted) => reducers.updateVoiceState(channelId, muted, audio.deafened, false, false),
    initiallyMuted: audio.muted,
  })
}

export async function joinLiveKitDmVoice(partnerIdentity: Identity, audio: CallAudioState = { muted: false, deafened: false }): Promise<Room> {
  const identity = useConnectionStore.getState().identity
  if (!identity) {
    throw new Error('Cannot join DM voice: no local identity')
  }
  const roomName = `dm:${dmVoiceRoomKey(identity, partnerIdentity)}`
  return startCall({ kind: 'dm', id: partnerIdentity }, {
    roomName,
    identityErrorMessage: 'Cannot join DM voice: no local identity',
    permissionDeniedWarning: 'Microphone permission denied; joined DM voice in listen-only mode.',
    micEnableWarning: 'Could not enable microphone automatically; joined DM voice in listen-only mode.',
    onJoinPresence: () => reducers.joinDmVoice(partnerIdentity),
    onLeavePresence: () => reducers.leaveDmVoice(partnerIdentity),
    onSyncMutedState: (muted) => reducers.updateDmVoiceState(partnerIdentity, muted, audio.deafened, false, false),
    initiallyMuted: audio.muted,
  })
}

export async function leaveLiveKitVoice(channelId: number, room: Room | null): Promise<void> {
  await endCall({ kind: 'channel', id: channelId }, room)
}

export async function leaveLiveKitDmVoice(partnerIdentity: Identity, room: Room | null): Promise<void> {
  await endCall({ kind: 'dm', id: partnerIdentity }, room)
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
