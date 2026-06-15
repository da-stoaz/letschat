import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { authServiceGenerateLivekitToken, clearStoredAuthSessionToken, getStoredAuthSessionToken } from './authService'
import { clearSignedDownloadUrlCache } from './uploads'
import { useServerConfigStore } from '../stores/serverConfigStore'
import type { Identity } from '../types/domain'
export type NotificationPermissionState = NotificationPermission | 'unsupported'
export type AttachmentDownloadProgressEvent = {
  operationId: string
  bytesDownloaded: number
  totalBytes: number | null
  completed: boolean
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'
}

export function isDesktopTauriRuntime(): boolean {
  return isTauriRuntime()
}

/**
 * True for the hosted browser build: running in a real browser (not the Tauri
 * desktop shell) with a connect URL baked in at build time. Such a build is
 * single-tenant — locked to its own deployment — so server-picker / change-server
 * affordances must be hidden (it would strand the locked-instance bootstrap).
 */
export function isHostedWebBuild(): boolean {
  const connectUrl = (import.meta.env.VITE_WEB_CONNECT_URL as string | undefined)?.trim()
  return !isDesktopTauriRuntime() && !!connectUrl
}

function isInvalidAuthSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.trim().toLowerCase() === 'invalid auth session.'
}

function forceSignOutForExpiredSession(): void {
  if (typeof window === 'undefined') return
  clearStoredAuthSessionToken()
  clearSignedDownloadUrlCache()
  localStorage.removeItem('spacetimedb.auth_token')
  setTimeout(() => {
    window.location.assign('/auth')
  }, 0)
}

/**
 * Resolves the LiveKit URL of the space the client is currently connected to.
 *
 * Both desktop and web read this from the discovered server config so voice
 * always targets the same space the user joined. We deliberately do NOT fall
 * back to a hardcoded localhost URL: doing so masks a missing/invalid config as
 * a confusing "Failed to fetch" deep inside livekit-client.
 */
function resolveLivekitUrl(): string {
  const livekitUrl = useServerConfigStore.getState().config?.livekitUrl
  if (!livekitUrl) {
    throw new Error('Voice is unavailable: no LiveKit URL is configured for this space. Reconnect to the space and try again.')
  }
  return livekitUrl
}

/**
 * Mints a LiveKit access token via the space's auth service, which signs it
 * with that server's real LiveKit secret. Used by both desktop and web.
 */
async function generateLivekitToken(room: string, identity: Identity): Promise<string> {
  const sessionToken = getStoredAuthSessionToken()
  if (!sessionToken) {
    throw new Error('Voice requires a valid session. Please log in again.')
  }
  try {
    return await authServiceGenerateLivekitToken({
      room,
      identity,
      sessionToken,
    })
  } catch (error) {
    if (isInvalidAuthSessionError(error)) {
      forceSignOutForExpiredSession()
      throw new Error('Session expired. Please log in again.')
    }
    throw error
  }
}

export const tauriCommands = {
  getLivekitUrl: async () => resolveLivekitUrl(),
  generateLivekitToken: async (room: string, identity: Identity) =>
    generateLivekitToken(room, identity),
  openUrl: async (url: string) => {
    if (isTauriRuntime()) return invoke<void>('open_url', { url })
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  showNotification: async (title: string, body: string) => {
    if (isTauriRuntime()) return invoke<void>('show_notification', { title, body })
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    new Notification(title, { body })
  },
  getNotificationPermission: async (): Promise<NotificationPermissionState> => {
    if (isTauriRuntime()) return 'granted'
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission
  },
  requestNotificationPermission: async (): Promise<NotificationPermissionState> => {
    if (isTauriRuntime()) return 'granted'
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
    return Notification.requestPermission()
  },
  setBadgeCount: async (count: number) => {
    if (isTauriRuntime()) return invoke<void>('set_badge_count', { count })
    void count
  },
  minimizeToTray: async () => {
    if (isTauriRuntime()) return invoke<void>('minimize_to_tray')
  },
  getAppVersion: async () =>
    isTauriRuntime() ? invoke<string>('get_app_version') : 'web',
  saveAttachmentFile: async (url: string, fileName: string, operationId: string): Promise<boolean> => {
    if (!isTauriRuntime()) return false
    return invoke<boolean>('save_attachment_file', { url, fileName, operationId })
  },
  cancelAttachmentDownload: async (operationId: string): Promise<void> => {
    if (!isTauriRuntime()) return
    await invoke<void>('cancel_attachment_download', { operationId })
  },
  onAttachmentDownloadProgress: async (
    callback: (event: AttachmentDownloadProgressEvent) => void,
  ): Promise<UnlistenFn> => {
    if (!isTauriRuntime()) {
      return () => undefined
    }
    return listen<AttachmentDownloadProgressEvent>('attachment-download-progress', (event) => {
      callback(event.payload)
    })
  },
}
