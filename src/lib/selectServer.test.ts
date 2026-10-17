import { beforeEach, expect, it, vi } from 'vitest'
const transport = vi.hoisted(() => ({ disconnect: vi.fn(), clearStoredToken: vi.fn(), initializeSpacetime: vi.fn(async () => {}), hosted: false }))
vi.mock('./spacetimedb/connection', () => transport)
vi.mock('./spacetimedb/auth', () => transport)
vi.mock('./tauri', () => ({ isHostedWebBuild: () => transport.hosted }))
vi.mock('./runtimeConfig', () => ({ WEB_CONNECT_URL: 'https://a.test' }))
import { selectServer, cancelServerSelection } from './selectServer'
import { acknowledgeCompatibility, connectionKey, useCompatibilityStore } from './compatibility'
import { AUTH_SESSION_KEY, useServerConfigStore } from '../stores/serverConfigStore'

const a = { authServiceUrl: 'https://a.test', spacetimedbUri: 'wss://a.test', livekitUrl: 'wss://voice.test', spacetimedbDatabase: 'letschat' }
const b = { ...a, authServiceUrl: 'https://b.test' }
const document = (config = a, protocol: number | undefined = 1) => ({ auth: config.authServiceUrl, spacetimedb: config.spacetimedbUri, livekit: config.livekitUrl, clientProtocol: protocol, minClient: '1.6.1' })
const memory = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) })
beforeEach(() => {
  cancelServerSelection()
  vi.clearAllMocks()
  memory.clear()
  transport.hosted = false
  useServerConfigStore.setState({ config: null, sessionHost: null, knownHosts: [], pendingHost: null })
  useCompatibilityStore.setState({ admittedKey: null })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(document()))))
})
it('commits compatible discovery before starting realtime', async () => {
  await selectServer(a)
  expect(useServerConfigStore.getState().config?.discoveryUrl).toBe(a.authServiceUrl)
  expect(transport.initializeSpacetime).toHaveBeenCalledOnce()
})
it('keeps the old host and both credentials when a proposed switch fails', async () => {
  useServerConfigStore.getState().setConfig(a)
  memory.set(AUTH_SESSION_KEY, 'auth-a')
  memory.set('spacetimedb.auth_token', 'db-a')
  useCompatibilityStore.setState({ admittedKey: connectionKey(a) })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(document(b, 2)))))
  await expect(selectServer(b)).rejects.toThrow()
  expect(transport.disconnect).not.toHaveBeenCalled()
  expect(transport.initializeSpacetime).not.toHaveBeenCalled()
  expect(useServerConfigStore.getState().config).toEqual(a)
  expect(memory.get(AUTH_SESSION_KEY)).toBe('auth-a')
  expect(memory.get('spacetimedb.auth_token')).toBe('db-a')
})
it('waits for both link trust and legacy acknowledgment before committing', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
  await selectServer(a, { confirmUnknown: true })
  expect(fetch).not.toHaveBeenCalled()
  const trusted = useServerConfigStore.getState().resolvePendingHost(true)!
  await expect(selectServer(trusted, { trusted: true })).rejects.toThrow()
  expect(useServerConfigStore.getState().config).toBeNull()
  expect(transport.initializeSpacetime).not.toHaveBeenCalled()
  acknowledgeCompatibility()
  await selectServer(a)
  expect(transport.initializeSpacetime).toHaveBeenCalledOnce()
})
it('never commits a late response from an abandoned selection', async () => {
  let resolveA!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn((url: string) => url.startsWith(a.authServiceUrl)
    ? new Promise<Response>(done => { resolveA = done }) : Promise.resolve(new Response(JSON.stringify(document(b))))))
  const first = selectServer(a)
  const rejected = expect(first).rejects.toThrow('cancelled')
  await selectServer(b)
  resolveA(new Response(JSON.stringify(document(a))))
  await rejected
  expect(useServerConfigStore.getState().config?.authServiceUrl).toBe(b.authServiceUrl)
  expect(transport.initializeSpacetime).toHaveBeenCalledOnce()
})
it('retains the token owner through the picker and forgetting the old host', async () => {
  useServerConfigStore.getState().setConfig(a)
  memory.set(AUTH_SESSION_KEY, 'auth-a')
  memory.set('spacetimedb.auth_token', 'db-a')
  useServerConfigStore.getState().clearConfig()
  useServerConfigStore.getState().forgetHost(a.authServiceUrl)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(document(b)))))
  await selectServer(b)
  expect(memory.has(AUTH_SESSION_KEY)).toBe(false)
  expect(memory.has('spacetimedb.auth_token')).toBe(false)
})
it('rejects external host switches in hosted web before any request or mutation', async () => {
  transport.hosted = true
  useServerConfigStore.getState().setConfig(a)
  await expect(selectServer(b)).rejects.toThrow('locked')
  expect(fetch).not.toHaveBeenCalled()
  expect(useServerConfigStore.getState().config).toEqual(a)
})
it('does not loop between endpoint trust and legacy acknowledgment for a moved server', async () => {
  useServerConfigStore.getState().setConfig(a)
  const moved = { ...a, spacetimedbUri: 'wss://moved.test' }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...document(moved), clientProtocol: undefined }))))
  await selectServer(moved)
  const trusted = useServerConfigStore.getState().resolvePendingHost(true)!
  await expect(selectServer(trusted, { trusted: true })).rejects.toThrow()
  acknowledgeCompatibility()
  await selectServer(moved)
  expect(useServerConfigStore.getState().pendingHost).toBeNull()
  expect(useServerConfigStore.getState().config?.spacetimedbUri).toBe(moved.spacetimedbUri)
  expect(transport.initializeSpacetime).toHaveBeenCalledOnce()
})
