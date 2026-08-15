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

/** Puts a host at the front of the list, without duplicating it. */
function rememberHost(hosts: ServerConfig[], config: ServerConfig): ServerConfig[] {
  return [config, ...hosts.filter((host) => hostKey(host) !== hostKey(config))]
}

/** A service URL that a known host is now advertising differently than before. */
export interface HostChange {
  field: 'spacetimedbUri' | 'livekitUrl' | 'spacetimedbDatabase'
  stored: string
  incoming: string
}

/** The fields pinned per host. `authServiceUrl` is excluded — it is the key. */
const PINNED_FIELDS: HostChange['field'][] = ['spacetimedbUri', 'livekitUrl', 'spacetimedbDatabase']

/**
 * Compares what a host is advertising now against what it served last time.
 *
 * <p>Returns `null` when the host has never been connected to (nothing to
 * compare), an empty array when it matches, and the differing fields
 * otherwise. A host that suddenly points its SpacetimeDB or LiveKit URL
 * somewhere else — hijacked DNS, an expired domain, a compromised box — is
 * exactly the case worth stopping on, because discovery is otherwise followed
 * without question.</p>
 */
export function diffKnownHost(hosts: ServerConfig[], incoming: ServerConfig): HostChange[] | null {
  const stored = hosts.find((host) => hostKey(host) === hostKey(incoming))
  if (!stored) return null

  return PINNED_FIELDS.flatMap((field) =>
    stored[field] === incoming[field] ? [] : [{ field, stored: stored[field], incoming: incoming[field] }],
  )
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

/** A connection held back until the user confirms it. */
export interface PendingHost {
  config: ServerConfig
  /** Empty when the host is simply unrecognised rather than changed. */
  changes: HostChange[]
  reason: 'changed' | 'unknown'
}

interface ServerConfigState {
  config: ServerConfig | null
  /** Every host successfully configured before, most recent first. */
  knownHosts: ServerConfig[]
  hasHydrated: boolean
  /** Set when {@link requestConnect} refuses to connect without confirmation. */
  pendingHost: PendingHost | null
  setConfig: (config: ServerConfig) => void
  /**
   * Gate in front of {@link setConfig} for user-facing connects. Returns true
   * when it is safe to proceed; false when confirmation is needed, having
   * parked the config in {@link pendingHost} for the dialog to pick up.
   *
   * `confirmUnknown` should be set on links the user did not type — deep links
   * and web join links — where an unfamiliar host is worth naming out loud.
   */
  requestConnect: (config: ServerConfig, options?: { confirmUnknown?: boolean }) => boolean
  resolvePendingHost: (accept: boolean) => ServerConfig | null
  forgetHost: (authServiceUrl: string) => void
  clearConfig: () => void
  setHasHydrated: (value: boolean) => void
}

export const useServerConfigStore = create<ServerConfigState>()(
  persist(
    (set, get) => ({
      config: null,
      knownHosts: [],
      hasHydrated: false,
      pendingHost: null,
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

          return { config, knownHosts: rememberHost(state.knownHosts, config) }
        }),
      requestConnect: (config, options) => {
        const state = get()
        const changes = diffKnownHost(state.knownHosts, config)

        if (changes === null) {
          if (!options?.confirmUnknown) return true
          set({ pendingHost: { config, changes: [], reason: 'unknown' } })
          return false
        }

        if (changes.length === 0) return true

        set({ pendingHost: { config, changes, reason: 'changed' } })
        return false
      },
      resolvePendingHost: (accept) => {
        const pending = get().pendingHost
        set({ pendingHost: null })
        if (!pending || !accept) return null

        get().setConfig(pending.config)
        return pending.config
      },
      forgetHost: (authServiceUrl) =>
        set((state) => ({
          knownHosts: state.knownHosts.filter((host) => host.authServiceUrl !== authServiceUrl),
        })),
      // Remember where we were on the way out. "Change server" is exactly the
      // moment the user wants this host kept — dropping the config without
      // recording it is how a host goes missing from its own recent list.
      clearConfig: () =>
        set((state) => ({
          config: null,
          knownHosts: state.config ? rememberHost(state.knownHosts, state.config) : state.knownHosts,
        })),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: 'letschat.server_config',
      // Only the durable facts. A pending confirmation is a live UI decision —
      // persisting it would resurrect a security prompt on the next launch with
      // no context for why it is there.
      partialize: (state) => ({ config: state.config, knownHosts: state.knownHosts }),
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
