import { invoke } from '@tauri-apps/api/core'
import { authServiceGenerateLivekitToken, getStoredAuthSessionToken } from './authService'
import type { Identity } from '../types/domain'

const WEB_LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? 'http://localhost:7880'

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'
}

async function generateWebLivekitToken(room: string, identity: Identity): Promise<string> {
  const sessionToken = getStoredAuthSessionToken()
  if (!sessionToken) {
    throw new Error('Voice on web requires a valid auth session. Please log in again.')
  }
  return authServiceGenerateLivekitToken({
    room,
    identity,
    sessionToken,
  })
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
    if (Notification.permission === 'granted') {
      new Notification(title, { body })
      return
    }
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        new Notification(title, { body })
      }
    }
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
