import { invoke } from '@tauri-apps/api/core'
import { authServiceGenerateLivekitToken, clearStoredAuthSessionToken, getStoredAuthSessionToken } from './authService'
import type { Identity } from '../types/domain'

const DEFAULT_WEB_LIVEKIT_URL = 'http://127.0.0.1:7880'
const WEB_LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? DEFAULT_WEB_LIVEKIT_URL
export type NotificationPermissionState = NotificationPermission | 'unsupported'

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'
}

export function isDesktopTauriRuntime(): boolean {
  return isTauriRuntime()
}

function isInvalidAuthSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.trim().toLowerCase() === 'invalid auth session.'
}

function forceWebSignOutForExpiredSession(): void {
  if (typeof window === 'undefined') return
  clearStoredAuthSessionToken()
  localStorage.removeItem('spacetimedb.auth_token')
  setTimeout(() => {
    window.location.assign('/auth')
  }, 0)
}

async function generateWebLivekitToken(room: string, identity: Identity): Promise<string> {
  const sessionToken = getStoredAuthSessionToken()
  if (!sessionToken) {
    throw new Error('Voice on web requires a valid auth session. Please log in again.')
  }
  try {
    return await authServiceGenerateLivekitToken({
      room,
      identity,
      sessionToken,
    })
  } catch (error) {
    if (isInvalidAuthSessionError(error)) {
      forceWebSignOutForExpiredSession()
      throw new Error('Auth session expired. Please log in again.')
    }
    throw error
  }
}

export const tauriCommands = {
  getLivekitUrl: async () =>
    isTauriRuntime() ? invoke<string>('get_livekit_url') : WEB_LIVEKIT_URL,
  generateLivekitToken: async (room: string, identity: string) =>
    isTauriRuntime()
      ? invoke<string>('generate_livekit_token', { room, identity })
      : generateWebLivekitToken(room, identity),
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
}
