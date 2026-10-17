import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateCompatibility } from './clientCompatibility'
import { acknowledgeCompatibility, cancelCompatibility, commitCompatibility, ensureServerCompatibility, isServerAdmitted, useCompatibilityStore } from './compatibility'
import { AUTH_SESSION_KEY, useServerConfigStore } from '../stores/serverConfigStore'
import { authServiceLogin, authServiceRegister } from './authService'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
const config = { authServiceUrl: 'https://a.test', spacetimedbUri: 'wss://a.test', livekitUrl: 'wss://voice.test', spacetimedbDatabase: 'letschat' }
const doc = { auth: config.authServiceUrl, spacetimedb: config.spacetimedbUri, livekit: config.livekitUrl, database: 'letschat', clientProtocol: 1, minClient: '1.6.1', serverVersion: '1.6.1', recommendedClient: '1.6.1' }
const serve = (body: object = doc, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

beforeEach(() => {
  cancelCompatibility()
  storage.clear()
  useCompatibilityStore.setState({ admittedKey: null })
  useServerConfigStore.setState({ config: null, sessionHost: null, knownHosts: [], pendingHost: null })
  serve()
})

describe('declared compatibility', () => {
  it('ignores unrelated release numbers and recommendations', () => {
    expect(evaluateCompatibility({ ...doc, serverVersion: '99.0.0', recommendedClient: '99.0.0' }).status).toBe('compatible')
  })
  it('uses SemVer boundaries, prereleases and build metadata', () => {
    expect(evaluateCompatibility(doc, '1.6.1').status).toBe('compatible')
    expect(evaluateCompatibility(doc, '1.6.1-rc.1').status).toBe('incompatible')
    expect(evaluateCompatibility(doc, '1.6.1+build').status).toBe('compatible')
    expect(evaluateCompatibility({ ...doc, minClient: '1.10.0' }, '1.9.0').status).toBe('incompatible')
  })
  it('never interprets missing or malformed metadata as compatible', () => {
    for (const patch of [{ clientProtocol: undefined }, { clientProtocol: '1' }, { clientProtocol: -1 }, { clientProtocol: 1.5 }, { minClient: null }, { minClient: 'garbage' }]) {
      expect(evaluateCompatibility({ ...doc, ...patch }).status).toBe('unknown')
    }
  })
  it('prioritises definite incompatibility over missing metadata', () => {
    expect(evaluateCompatibility({ clientProtocol: 2 }).status).toBe('incompatible')
    expect(evaluateCompatibility({ minClient: '99.0.0' }).status).toBe('incompatible')
  })
})

describe('shared admission', () => {
  it('deduplicates concurrent discovery and refreshes for reconnects', async () => {
    useServerConfigStore.getState().setConfig(config)
    const first = ensureServerCompatibility(config, true)
    expect(ensureServerCompatibility(config, true)).toBe(first)
    const admitted = await first
    expect(isServerAdmitted(admitted)).toBe(true)
    await ensureServerCompatibility(admitted)
    expect(fetch).toHaveBeenCalledTimes(1)
    serve({ ...doc, clientProtocol: 2 })
    await expect(ensureServerCompatibility(admitted, true)).rejects.toThrow('protocol')
    expect(isServerAdmitted(admitted)).toBe(false)
  })
  it('preserves current credentials and configuration when another backend is incompatible', async () => {
    useServerConfigStore.getState().setConfig(config)
    localStorage.setItem(AUTH_SESSION_KEY, 'session-a')
    await ensureServerCompatibility(config)
    const other = { ...config, authServiceUrl: 'https://b.test' }
    serve({ ...doc, auth: other.authServiceUrl, clientProtocol: 2 })
    await expect(ensureServerCompatibility(other)).rejects.toThrow('protocol')
    expect(useServerConfigStore.getState().config?.authServiceUrl).toBe(config.authServiceUrl)
    expect(localStorage.getItem(AUTH_SESSION_KEY)).toBe('session-a')
    expect(isServerAdmitted(useServerConfigStore.getState().config)).toBe(true)
  })
  it('admits a legacy 404 only after explicit acknowledgment with complete connection details', async () => {
    serve({}, 404)
    await expect(ensureServerCompatibility(config)).rejects.toThrow('compatibility information')
    acknowledgeCompatibility()
    const accepted = await ensureServerCompatibility(config, true)
    commitCompatibility(accepted)
    expect(isServerAdmitted(accepted)).toBe(true)
    cancelCompatibility()
    await expect(ensureServerCompatibility(config, true)).rejects.toThrow('compatibility information')
    await expect(ensureServerCompatibility({ ...config, livekitUrl: '' })).rejects.toThrow('missing fields')
  })
  it('resets acknowledgment on metadata change and host switch', async () => {
    serve({ ...doc, clientProtocol: undefined })
    await expect(ensureServerCompatibility(config)).rejects.toThrow()
    acknowledgeCompatibility()
    await ensureServerCompatibility(config, true)
    serve({ ...doc, clientProtocol: undefined, serverVersion: '1.7.0' })
    await expect(ensureServerCompatibility(config, true)).rejects.toThrow()
    acknowledgeCompatibility()
    await ensureServerCompatibility(config, true)
    const other = { ...config, authServiceUrl: 'https://b.test' }
    serve({ ...doc, auth: other.authServiceUrl })
    await ensureServerCompatibility(other, true)
    serve({ ...doc, clientProtocol: undefined, serverVersion: '1.7.0' })
    await expect(ensureServerCompatibility(config, true)).rejects.toThrow()
  })
  it('does not treat network failure as legacy permission', async () => {
    serve({}, 503)
    await expect(ensureServerCompatibility(config)).rejects.toMatchObject({ retryable: true })
    acknowledgeCompatibility()
    await expect(ensureServerCompatibility(config, true)).rejects.toThrow()
    expect(useCompatibilityStore.getState().notice?.status).toBe('unreachable')
  })
  it('requires host confirmation when fresh endpoints move, including auth', async () => {
    useServerConfigStore.getState().setConfig(config)
    serve({ ...doc, auth: 'https://moved.test' })
    await expect(ensureServerCompatibility(config)).rejects.toThrow('Confirm')
    expect(useServerConfigStore.getState().config).toEqual(config)
    expect(useServerConfigStore.getState().pendingHost?.changes[0].field).toBe('authServiceUrl')
    expect(isServerAdmitted(config)).toBe(false)
  })
  it('discards late discovery results after cancellation or another selection', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done })))
    const pending = ensureServerCompatibility(config)
    const rejected = expect(pending).rejects.toThrow('cancelled')
    cancelCompatibility()
    resolve(new Response(JSON.stringify(doc)))
    await rejected
    expect(useCompatibilityStore.getState().notice).toBeNull()
    expect(() => commitCompatibility(config)).toThrow()
  })
  it.each(['incompatible', 'unknown'] as const)('sends no login or registration request while %s', async status => {
    useServerConfigStore.getState().setConfig(config)
    serve({ ...doc, clientProtocol: status === 'incompatible' ? 2 : undefined })
    await expect(authServiceLogin({ username: 'alice', password: 'password123' })).rejects.toThrow()
    await expect(authServiceRegister({ username: 'alice', password: 'password123', displayName: 'Alice', email: 'alice@test.local' })).rejects.toThrow()
    for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).toContain('/.well-known/letschat.json')
    expect(localStorage.getItem(AUTH_SESSION_KEY)).toBeNull()
  })
})

it('holds authentication behind an in-flight refresh even when previously admitted', async () => {
  useServerConfigStore.getState().setConfig(config)
  const admitted = await ensureServerCompatibility(config)
  let finish!: (response: Response) => void
  const fetchMock = vi.fn(() => new Promise<Response>(done => { finish = done }))
  vi.stubGlobal('fetch', fetchMock)
  const refresh = ensureServerCompatibility(admitted, true)
  const rejectedRefresh = expect(refresh).rejects.toThrow('protocol')
  const login = authServiceLogin({ username: 'alice', password: 'password123' })
  const rejectedLogin = expect(login).rejects.toThrow('protocol')
  expect(fetchMock).toHaveBeenCalledOnce()
  finish(new Response(JSON.stringify({ ...doc, clientProtocol: 2 })))
  await rejectedRefresh
  await rejectedLogin
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('refreshes before a new login even after successful admission', async () => {
  useServerConfigStore.getState().setConfig(config)
  await ensureServerCompatibility(config)
  serve({ ...doc, clientProtocol: 2 })
  await expect(authServiceLogin({ username: 'alice', password: 'password123' })).rejects.toThrow('protocol')
  expect(fetch).toHaveBeenCalledOnce()
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/.well-known/letschat.json')
  expect(localStorage.getItem(AUTH_SESSION_KEY)).toBeNull()
})
