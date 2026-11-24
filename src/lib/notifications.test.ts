import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tauri', () => ({
  tauriCommands: {
    showNotification: vi.fn(async () => undefined),
    getNotificationPermission: vi.fn(async () => 'granted'),
    requestNotificationPermission: vi.fn(async () => 'granted'),
    setBadgeCount: vi.fn(async () => undefined),
  },
}))

import { notify, sendTestNotification } from './notifications'
import { tauriCommands } from './tauri'
import { useUiStore } from '../stores/uiStore'

const shown = vi.mocked(tauriCommands.showNotification)
const defaults = useUiStore.getState().notificationSettings
const settings = (patch: Partial<typeof defaults>) =>
  useUiStore.setState({ notificationSettings: { ...defaults, ...patch } })

let clock = Date.parse('2026-01-05T12:00:00')
let key = 0
const dm = () => notify('direct_message', { senderLabel: 'Bo', content: 'secret plans', dedupeKey: `k${key++}` })

describe('notification settings', () => {
  beforeEach(() => {
    // Past the rate-limit window every time, so tests never throttle each other.
    clock += 60_000
    vi.useFakeTimers({ now: clock })
    shown.mockClear()
    settings({})
  })

  it('shows by default', async () => {
    expect(await dm()).toBe(true)
    expect(shown).toHaveBeenCalledWith('Bo', 'secret plans')
  })

  it('master switch silences everything', async () => {
    settings({ enabled: false })
    expect(await dm()).toBe(false)
  })

  it('per-event toggle silences only its event', async () => {
    settings({ eventToggles: { ...defaults.eventToggles, directMessages: false } })
    expect(await dm()).toBe(false)
    expect(await notify('friend_request', { username: 'Bo' })).toBe(true)
  })

  it('previews off hides the content', async () => {
    settings({ showPreviews: false })
    await dm()
    expect(shown).toHaveBeenCalledWith('Bo', 'New direct message')
  })

  it('quiet hours spanning midnight apply on both sides of it', async () => {
    settings({ quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' })
    vi.setSystemTime(new Date('2026-01-05T23:30:00'))
    expect(await dm()).toBe(false)
    vi.setSystemTime(new Date('2026-01-06T06:59:00'))
    expect(await dm()).toBe(false)
    vi.setSystemTime(new Date('2026-01-06T07:00:00'))
    expect(await dm()).toBe(true)
  })

  it('the test notification ignores quiet hours and the master switch', async () => {
    settings({ enabled: false, quietHoursEnabled: true, quietHoursStart: '00:00', quietHoursEnd: '23:59' })
    expect(await sendTestNotification()).toBe(true)
    expect(shown).toHaveBeenCalledTimes(1)
  })
})
