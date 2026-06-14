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

vi.mock('../stores/serverConfigStore', () => ({
  useServerConfigStore: { getState: () => serverConfig },
}))

const { tauriCommands } = await import('./tauri')

beforeEach(() => {
  serverConfig.config = null
  authServiceGenerateLivekitToken.mockReset()
  getStoredAuthSessionToken.mockReset()
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
  it('mints a token via the auth service with the stored session token', async () => {
    const sessionToken = { access_token: 'session-abc' }
    getStoredAuthSessionToken.mockReturnValue(sessionToken)
    authServiceGenerateLivekitToken.mockResolvedValue('livekit-token')

    const token = await tauriCommands.generateLivekitToken('42', 'identity-abc')

    expect(token).toBe('livekit-token')
    expect(authServiceGenerateLivekitToken).toHaveBeenCalledWith({
      room: '42',
      identity: 'identity-abc',
      sessionToken,
    })
  })

  it('refuses to mint a token when there is no session', async () => {
    getStoredAuthSessionToken.mockReturnValue(null)

    await expect(tauriCommands.generateLivekitToken('42', 'identity-abc')).rejects.toThrow(
      /valid session/i,
    )
    expect(authServiceGenerateLivekitToken).not.toHaveBeenCalled()
  })
})
