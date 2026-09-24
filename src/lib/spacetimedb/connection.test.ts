import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  disconnect: vi.fn(),
  resetClientState: vi.fn(),
  unsubscribe: vi.fn(),
  clearStoredAuthSessionToken: vi.fn(),
  tokens: [] as Array<string | undefined>,
  uri: 'wss://chat.example',
  rejectToken: true,
  connectionState: {
    status: 'disconnected',
    errorMessage: null as string | null,
    identity: 'account-identity' as string | null,
    synced: true,
  },
}))

vi.mock('../../generated', () => ({
  tables: new Proxy({}, { get: (_target, property) => String(property) }),
  DbConnection: {
    builder: () => {
      let onConnectError: ((ctx: unknown, error: Error) => void) | undefined
      let onDisconnect: (() => void) | undefined
      const builder = {
        withUri: vi.fn(() => builder),
        withDatabaseName: vi.fn(() => builder),
        withLightMode: vi.fn(() => builder),
        withCompression: vi.fn(() => builder),
        withToken: vi.fn((token?: string) => {
          mocks.tokens.push(token)
          return builder
        }),
        onConnect: vi.fn(() => builder),
        onDisconnect: vi.fn((callback: () => void) => {
          onDisconnect = callback
          return builder
        }),
        onConnectError: vi.fn((callback: (ctx: unknown, error: Error) => void) => {
          onConnectError = callback
          return builder
        }),
        build: vi.fn(() => {
          mocks.build()
          if (mocks.rejectToken) {
            queueMicrotask(() => onConnectError?.({}, new Error('Failed to verify token: Unauthorized')))
          }
          return {
            isActive: false,
            reducers: {},
            disconnect: () => {
              mocks.disconnect()
              onDisconnect?.()
            },
            subscriptionBuilder: () => {
              const subscription = {
                onApplied: vi.fn(() => subscription),
                onError: vi.fn(() => subscription),
                subscribe: vi.fn(() => ({ unsubscribe: mocks.unsubscribe })),
              }
              return subscription
            },
          }
        }),
      }
      return builder
    },
  },
}))

vi.mock('./events', () => ({
  cancelPendingRefreshes: vi.fn(),
  watchLiveTables: vi.fn(),
}))

vi.mock('./sync', () => ({
  syncAll: vi.fn(),
  resetClientState: () => {
    mocks.resetClientState()
    mocks.connectionState.identity = null
    mocks.connectionState.synced = false
  },
}))

vi.mock('../notifications', () => ({ notify: vi.fn(async () => true) }))
vi.mock('../tauri', () => ({ isDesktopTauriRuntime: () => true }))
vi.mock('../authService', () => ({
  clearStoredAuthSessionToken: () => {
    mocks.clearStoredAuthSessionToken()
    localStorage.removeItem('letschat.auth_session_token')
  },
}))

vi.mock('../../stores/connectionStore', () => ({
  useConnectionStore: {
    getState: () => ({
      ...mocks.connectionState,
      setStatus: (status: string, errorMessage: string | null = null) => {
        mocks.connectionState.status = status
        mocks.connectionState.errorMessage = errorMessage
      },
      setIdentity: (identity: string | null) => {
        mocks.connectionState.identity = identity
      },
      setSynced: (synced: boolean) => {
        mocks.connectionState.synced = synced
      },
    }),
  },
}))

vi.mock('../../stores/serverConfigStore', () => ({
  useServerConfigStore: {
    getState: () => ({
      config: {
        spacetimedbUri: mocks.uri,
        spacetimedbDatabase: 'letschat',
      },
    }),
  },
}))

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
})

const { connect, disconnect, REAUTHENTICATION_REQUIRED_MESSAGE } = await import('./connection')

describe('rejected stored SpacetimeDB token', () => {
  beforeEach(() => {
    storage.clear()
    localStorage.setItem('spacetimedb.auth_token', 'account-token')
    localStorage.setItem('letschat.auth_session_token', 'core-api-session')
    mocks.tokens.length = 0
    mocks.connectionState.status = 'disconnected'
    mocks.connectionState.errorMessage = null
    mocks.connectionState.identity = 'account-identity'
    mocks.connectionState.synced = true
    vi.clearAllMocks()
  })

  it('fails closed instead of reconnecting anonymously', async () => {
    await expect(connect()).rejects.toThrow(REAUTHENTICATION_REQUIRED_MESSAGE)

    expect(mocks.tokens).toEqual(['account-token'])
    expect(mocks.build).toHaveBeenCalledOnce()
    expect(localStorage.getItem('spacetimedb.auth_token')).toBeNull()
    expect(localStorage.getItem('letschat.auth_session_token')).toBeNull()
    expect(mocks.clearStoredAuthSessionToken).toHaveBeenCalledOnce()
    expect(mocks.disconnect).toHaveBeenCalledOnce()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    expect(mocks.resetClientState).toHaveBeenCalledOnce()
    expect(mocks.connectionState).toMatchObject({
      status: 'error',
      errorMessage: REAUTHENTICATION_REQUIRED_MESSAGE,
      identity: null,
      synced: false,
    })
  })
})

// BUG_ANALYSIS E2: tearing down the socket that is still being built rejected
// that attempt, and connect() went on to the next URI candidate — opening a
// fresh connection after the user had signed out.
describe('signing out while connecting', () => {
  beforeEach(() => {
    storage.clear()
    localStorage.setItem('spacetimedb.auth_token', 'account-token')
    mocks.uri = 'ws://localhost:4300' // loopback: several candidates to fall through
    mocks.rejectToken = false
    mocks.connectionState.status = 'disconnected'
    vi.clearAllMocks()
  })

  it('abandons the attempt instead of opening another socket', async () => {
    const pending = connect()
    disconnect()

    await expect(pending).resolves.toBeUndefined()
    expect(mocks.build).toHaveBeenCalledOnce()
    expect(mocks.connectionState.status).toBe('disconnected')
  })
})
