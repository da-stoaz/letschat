import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ServerConfig {
  spacetimedbUri: string
  spacetimedbDatabase: string
  authServiceUrl: string
  livekitUrl: string
}

interface ServerConfigState {
  config: ServerConfig | null
  hasHydrated: boolean
  setConfig: (config: ServerConfig) => void
  clearConfig: () => void
  setHasHydrated: (value: boolean) => void
}

export const useServerConfigStore = create<ServerConfigState>()(
  persist(
    (set) => ({
      config: null,
      hasHydrated: false,
      setConfig: (config) => set({ config }),
      clearConfig: () => set({ config: null }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: 'letschat.server_config',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    },
  ),
)

/** Builds a letschat://join?... deep-link URL from a config. */
export function buildJoinLink(config: ServerConfig): string {
  const params = new URLSearchParams({
    s: config.spacetimedbUri,
    a: config.authServiceUrl,
    l: config.livekitUrl,
    d: config.spacetimedbDatabase,
  })
  return `letschat://join?${params.toString()}`
}

/** Parses a letschat://join?... deep-link URL into a ServerConfig, or returns null. */
export function parseJoinLink(raw: string): ServerConfig | null {
  try {
    const url = raw.startsWith('letschat://')
      ? new URL(raw.replace('letschat://', 'http://letschat/'))
      : new URL(raw)
    const s = url.searchParams.get('s')
    const a = url.searchParams.get('a')
    const l = url.searchParams.get('l')
    const d = url.searchParams.get('d')
    if (!s || !a || !l || !d) return null
    return { spacetimedbUri: s, authServiceUrl: a, livekitUrl: l, spacetimedbDatabase: d }
  } catch {
    return null
  }
}
