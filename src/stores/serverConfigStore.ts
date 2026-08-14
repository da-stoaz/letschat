import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ServerConfig {
  spacetimedbUri: string
  spacetimedbDatabase: string
  authServiceUrl: string
  livekitUrl: string
}

/**
 * Where the app session token is persisted. It lives here rather than in
 * `authService` so this store can drop it when the user moves to a different
 * host without importing authService (which imports this store — that would be
 * a cycle). `authService` imports the constant from here.
 */
export const AUTH_SESSION_KEY = 'letschat.auth_session_token'

/**
 * A host's stable identity for the known-hosts list. `authServiceUrl` is the
 * discovery root, so it identifies the instance; `spacetimedbUri` deliberately
 * does not, because the connection layer rewrites it in place when it falls
 * back to an alternate candidate URI for the *same* host.
 */
function hostKey(config: ServerConfig): string {
  return config.authServiceUrl
}

/** Human label for a host — the discovery hostname, or the raw URL if unparseable. */
export function hostLabel(config: ServerConfig): string {
  try {
    return new URL(config.authServiceUrl).host
  } catch {
    return config.authServiceUrl
  }
}

/**
 * Folds persisted state over the store's defaults on load.
 *
 * <p>Installs that predate {@link ServerConfigState.knownHosts} have a saved
 * config but no list, so the server the user is already on would be missing
 * from its own "recent servers" — seed it from the active config.</p>
 *
 * Exported for tests; zustand calls it via the persist `merge` option.
 */
export function mergePersisted(persisted: unknown, current: ServerConfigState): ServerConfigState {
  const merged = { ...current, ...(persisted as Partial<ServerConfigState> | undefined) }
  const knownHosts = merged.knownHosts ?? []
  return {
    ...merged,
    knownHosts: knownHosts.length === 0 && merged.config ? [merged.config] : knownHosts,
  }
}

interface ServerConfigState {
  config: ServerConfig | null
  /** Every host successfully configured before, most recent first. */
  knownHosts: ServerConfig[]
  hasHydrated: boolean
  setConfig: (config: ServerConfig) => void
  forgetHost: (authServiceUrl: string) => void
  clearConfig: () => void
  setHasHydrated: (value: boolean) => void
}

export const useServerConfigStore = create<ServerConfigState>()(
  persist(
    (set) => ({
      config: null,
      knownHosts: [],
      hasHydrated: false,
      setConfig: (config) =>
        set((state) => {
          // A session token is only meaningful to the host that issued it.
          // Carrying one across a host switch would hand instance A's bearer
          // token to instance B, so drop it whenever the host actually changes.
          // Re-setting the same host (hosted-web bootstrap on every load, or
          // the SpacetimeDB URI-candidate rewrite) must NOT sign the user out.
          if (state.config && hostKey(state.config) !== hostKey(config)) {
            localStorage.removeItem(AUTH_SESSION_KEY)
          }

          return {
            config,
            knownHosts: [config, ...state.knownHosts.filter((host) => hostKey(host) !== hostKey(config))],
          }
        }),
      forgetHost: (authServiceUrl) =>
        set((state) => ({
          knownHosts: state.knownHosts.filter((host) => host.authServiceUrl !== authServiceUrl),
        })),
      clearConfig: () => set({ config: null }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: 'letschat.server_config',
      merge: (persisted, current) => mergePersisted(persisted, current),
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
