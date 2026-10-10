import type { Identity } from '../../types/domain'
import type { ServerConfig } from '../../stores/serverConfigStore'

export type CallTarget = { kind: 'channel'; id: number } | { kind: 'dm'; id: Identity }
export type CallAudioState = { muted: boolean; deafened: boolean }
type SavedCall = CallAudioState & {
  target: CallTarget
  identity: Identity
  host: string
  database: string
}
const KEY = 'letschat.call-reload'

export function clearCallReload(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* Storage may be unavailable. */ }
}

export function saveCallReload(target: CallTarget, audio: CallAudioState, identity: Identity, config: ServerConfig): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ target, ...audio, identity, host: config.authServiceUrl, database: config.spacetimedbDatabase }))
  } catch { /* Reload recovery is optional when storage is unavailable. */ }
}

/** Consume once, only on reload in the same tab, account and server. */
export function takeCallReload(identity: Identity, config: ServerConfig): SavedCall | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    clearCallReload()
    if (!raw || (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type !== 'reload') return null
    const saved: SavedCall = JSON.parse(raw)
    if (saved.identity !== identity || saved.host !== config.authServiceUrl || saved.database !== config.spacetimedbDatabase ||
      typeof saved.muted !== 'boolean' || typeof saved.deafened !== 'boolean') return null
    if (saved.target?.kind === 'channel' && Number.isSafeInteger(saved.target.id) && saved.target.id > 0) return saved
    if (saved.target?.kind === 'dm' && typeof saved.target.id === 'string' && saved.target.id.trim()) return saved
  } catch { /* Ignore stale or malformed saved calls. */ }
  return null
}
