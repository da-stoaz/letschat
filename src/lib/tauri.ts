import { invoke } from '@tauri-apps/api/core'

export const tauriCommands = {
  getLivekitUrl: () => invoke<string>('get_livekit_url'),
  generateLivekitToken: (room: string, identity: string) =>
    invoke<string>('generate_livekit_token', { room, identity }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  showNotification: (title: string, body: string) => invoke<void>('show_notification', { title, body }),
  setBadgeCount: (count: number) => invoke<void>('set_badge_count', { count }),
  minimizeToTray: () => invoke<void>('minimize_to_tray'),
  getAppVersion: () => invoke<string>('get_app_version'),
}
