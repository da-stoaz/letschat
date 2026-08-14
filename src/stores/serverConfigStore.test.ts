import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store persists through localStorage, which the `node` test environment
// does not provide. A Map-backed stub is enough for these cases.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
})

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

  it('labels a host by its discovery hostname', () => {
    expect(hostLabel(hostA)).toBe('auth.a.example')
    expect(hostLabel({ ...hostA, authServiceUrl: 'not a url' })).toBe('not a url')
  })
})
