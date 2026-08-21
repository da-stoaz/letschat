import { beforeEach, describe, expect, it, vi } from 'vitest'

// tauri.ts pulls in the Tauri bridge, the auth service and the config store. We
// stub all of them so these tests exercise only the LiveKit URL/token logic —
// the bug we fixed was the desktop path ignoring the discovered space config.

// Mutable holder so each test controls what the discovered config resolves to.
const serverConfig: { config: { livekitUrl: string } | null } = { config: null }

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('./uploads', () => ({ clearSignedDownloadUrlCache: vi.fn() }))

const authServiceGenerateLivekitToken = vi.fn()
const getStoredAuthSessionToken = vi.fn()
vi.mock('./authService', () => ({
  authServiceGenerateLivekitToken: (...args: unknown[]) => authServiceGenerateLivekitToken(...args),
  getStoredAuthSessionToken: () => getStoredAuthSessionToken(),
  clearStoredAuthSessionToken: vi.fn(),
}))

// Voice must renew an expiring session the same way uploads do, instead of
// signing the user out mid-join.
const withSessionTokenRetry = vi.fn()
vi.mock('./uploadSession', () => ({
  withSessionTokenRetry: (fn: (token: unknown) => Promise<unknown>) => withSessionTokenRetry(fn),
}))

vi.mock('../stores/serverConfigStore', () => ({
  useServerConfigStore: { getState: () => serverConfig },
}))

const { tauriCommands } = await import('./tauri')

beforeEach(() => {
  serverConfig.config = null
  authServiceGenerateLivekitToken.mockReset()
  getStoredAuthSessionToken.mockReset()
  // Default: the wrapper hands the caller a freshly renewed session token.
  withSessionTokenRetry.mockReset()
  withSessionTokenRetry.mockImplementation((fn: (token: unknown) => Promise<unknown>) =>
    fn({ access_token: 'renewed-session' }),
  )
})

describe('tauriCommands.getLivekitUrl', () => {
  it('returns the discovered space LiveKit URL', async () => {
    serverConfig.config = { livekitUrl: 'wss://livekit.example.com' }

    await expect(tauriCommands.getLivekitUrl()).resolves.toBe('wss://livekit.example.com')
  })

  it('throws instead of silently falling back to localhost when unconfigured', async () => {
    serverConfig.config = null

    await expect(tauriCommands.getLivekitUrl()).rejects.toThrow(/no LiveKit URL/i)
  })
})

describe('tauriCommands.generateLivekitToken', () => {
  it('mints a token with a renewed session rather than the possibly stale stored one', async () => {
    getStoredAuthSessionToken.mockReturnValue({ access_token: 'session-abc' })
    authServiceGenerateLivekitToken.mockResolvedValue('livekit-token')

    const token = await tauriCommands.generateLivekitToken('42', 'identity-abc')

    expect(token).toBe('livekit-token')
    expect(withSessionTokenRetry).toHaveBeenCalledOnce()
    expect(authServiceGenerateLivekitToken).toHaveBeenCalledWith({
      room: '42',
      identity: 'identity-abc',
      sessionToken: { access_token: 'renewed-session' },
    })
  })

  it('does not sign the user out when the session merely needs renewing', async () => {
    // The regression: joining voice with an expired session used to clear the
    // stored tokens and bounce the user to /auth instead of refreshing.
    getStoredAuthSessionToken.mockReturnValue({ access_token: 'expired' })
    let attempts = 0
    withSessionTokenRetry.mockImplementation(async (fn: (token: unknown) => Promise<unknown>) => {
      attempts += 1
      if (attempts === 1) {
        await expect(fn({ access_token: 'expired' })).rejects.toThrow(/invalid auth session/i)
      }
      return fn({ access_token: 'renewed-session' })
    })
    authServiceGenerateLivekitToken.mockImplementation(
      ({ sessionToken }: { sessionToken: { access_token: string } }) =>
        sessionToken.access_token === 'expired'
          ? Promise.reject(new Error('Invalid auth session.'))
          : Promise.resolve('livekit-token'),
    )

    await expect(tauriCommands.generateLivekitToken('42', 'identity-abc')).resolves.toBe(
      'livekit-token',
    )
  })

  it('refuses to mint a token when there is no session', async () => {
    getStoredAuthSessionToken.mockReturnValue(null)

    await expect(tauriCommands.generateLivekitToken('42', 'identity-abc')).rejects.toThrow(
      /valid session/i,
    )
    expect(authServiceGenerateLivekitToken).not.toHaveBeenCalled()
  })
})
