import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store persists through localStorage, which the `node` test environment
// does not provide. A Map-backed stub stands in.
//
// It must be reachable as BOTH `localStorage` (the store's own token-clearing
// call) and `window.localStorage` — zustand's persist resolves its default
// storage via `createJSONStorage(() => window.localStorage)` and silently
// disables persistence when that throws. Stubbing only the bare global left
// every test here passing while nothing was ever actually persisted.
const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
}
vi.stubGlobal('localStorage', localStorageStub)
vi.stubGlobal('window', { localStorage: localStorageStub })

const { AUTH_SESSION_KEY, hostLabel, mergePersisted, useServerConfigStore } = await import('./serverConfigStore')

const hostA = {
  spacetimedbUri: 'ws://a.example:4300',
  spacetimedbDatabase: 'letschat',
  authServiceUrl: 'https://auth.a.example',
  livekitUrl: 'ws://a.example:7880',
}
const hostB = { ...hostA, authServiceUrl: 'https://auth.b.example', spacetimedbUri: 'ws://b.example:4300' }

describe('serverConfigStore known hosts', () => {
  beforeEach(() => {
    store.clear()
    useServerConfigStore.setState({ config: null, knownHosts: [] })
  })

  it('records every configured host, most recent first, without duplicates', () => {
    const { setConfig } = useServerConfigStore.getState()
    setConfig(hostA)
    setConfig(hostB)
    setConfig(hostA)

    const { knownHosts } = useServerConfigStore.getState()
    expect(knownHosts.map((h) => h.authServiceUrl)).toEqual([hostA.authServiceUrl, hostB.authServiceUrl])
  })

  it('drops the session token when the host changes', () => {
    localStorage.setItem(AUTH_SESSION_KEY, 'token-for-a')
    useServerConfigStore.getState().setConfig(hostA)
    expect(localStorage.getItem(AUTH_SESSION_KEY)).toBe('token-for-a')

    useServerConfigStore.getState().setConfig(hostB)
    expect(localStorage.getItem(AUTH_SESSION_KEY)).toBeNull()
  })

  it('keeps the session token when the same host is re-set', () => {
    useServerConfigStore.getState().setConfig(hostA)
    localStorage.setItem(AUTH_SESSION_KEY, 'token-for-a')

    // The connection layer rewrites spacetimedbUri in place when it falls back
    // to another candidate for the same host — that must not sign the user out.
    useServerConfigStore.getState().setConfig({ ...hostA, spacetimedbUri: 'ws://127.0.0.1:4300' })
    expect(localStorage.getItem(AUTH_SESSION_KEY)).toBe('token-for-a')
  })

  it('remembers the host it just left when the config is cleared', () => {
    // "Change server" clears the config; the host must survive that, or it
    // vanishes from the very list that exists to bring the user back to it.
    useServerConfigStore.getState().setConfig(hostA)
    useServerConfigStore.setState({ knownHosts: [] })

    useServerConfigStore.getState().clearConfig()

    const state = useServerConfigStore.getState()
    expect(state.config).toBeNull()
    expect(state.knownHosts.map((h) => h.authServiceUrl)).toEqual([hostA.authServiceUrl])
  })

  it('does not duplicate the host when clearing a config already in the list', () => {
    const { setConfig } = useServerConfigStore.getState()
    setConfig(hostA)
    setConfig(hostB)

    useServerConfigStore.getState().clearConfig()

    expect(useServerConfigStore.getState().knownHosts.map((h) => h.authServiceUrl)).toEqual([
      hostB.authServiceUrl,
      hostA.authServiceUrl,
    ])
  })

  it('forgets a host on request', () => {
    const { setConfig } = useServerConfigStore.getState()
    setConfig(hostA)
    setConfig(hostB)

    useServerConfigStore.getState().forgetHost(hostA.authServiceUrl)
    expect(useServerConfigStore.getState().knownHosts.map((h) => h.authServiceUrl)).toEqual([hostB.authServiceUrl])
  })

  it('seeds the list from an existing config saved before knownHosts existed', () => {
    const current = useServerConfigStore.getState()

    // What an older install has persisted: a config, and no knownHosts key.
    const merged = mergePersisted({ config: hostA, hasHydrated: false }, current)

    expect(merged.knownHosts.map((h) => h.authServiceUrl)).toEqual([hostA.authServiceUrl])
  })

  it('leaves an already-populated list alone on load', () => {
    const current = useServerConfigStore.getState()

    const merged = mergePersisted({ config: hostB, knownHosts: [hostA, hostB] }, current)

    expect(merged.knownHosts.map((h) => h.authServiceUrl)).toEqual([
      hostA.authServiceUrl,
      hostB.authServiceUrl,
    ])
  })

  it('seeds nothing when there is no saved config', () => {
    expect(mergePersisted({ config: null }, useServerConfigStore.getState()).knownHosts).toEqual([])
  })

  it('really rehydrates a persisted list through zustand, not just mergePersisted', async () => {
    // The whole path an app restart takes: persisted JSON -> storage ->
    // zustand persist -> merge -> state. mergePersisted alone cannot catch a
    // storage that is not wired up, which is exactly what went wrong.
    store.set(
      'letschat.server_config',
      JSON.stringify({ state: { config: hostA, knownHosts: [hostA, hostB] }, version: 0 }),
    )
    vi.resetModules()
    const fresh = await import('./serverConfigStore')

    const state = fresh.useServerConfigStore.getState()
    expect(state.config?.authServiceUrl).toBe(hostA.authServiceUrl)
    expect(state.knownHosts.map((h) => h.authServiceUrl)).toEqual([
      hostA.authServiceUrl,
      hostB.authServiceUrl,
    ])
  })

  it('seeds a pre-knownHosts install on a real restart', async () => {
    store.set(
      'letschat.server_config',
      JSON.stringify({ state: { config: hostA, hasHydrated: false }, version: 0 }),
    )
    vi.resetModules()
    const fresh = await import('./serverConfigStore')

    expect(fresh.useServerConfigStore.getState().knownHosts.map((h) => h.authServiceUrl)).toEqual([
      hostA.authServiceUrl,
    ])
  })

  it('persists knownHosts so the next restart can read them back', async () => {
    useServerConfigStore.getState().setConfig(hostA)

    const written = JSON.parse(store.get('letschat.server_config') ?? '{}')
    expect(written.state.knownHosts.map((h: { authServiceUrl: string }) => h.authServiceUrl)).toEqual([
      hostA.authServiceUrl,
    ])
  })

  it('labels a host by its discovery hostname', () => {
    expect(hostLabel(hostA)).toBe('auth.a.example')
    expect(hostLabel({ ...hostA, authServiceUrl: 'not a url' })).toBe('not a url')
  })
})
