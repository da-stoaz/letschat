import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverConfig, normalizeServerUrl } from './discovery'

// BUG_ANALYSIS E3: a bare hostname fell back to plain http, and the discovery
// document fetched that way decides where every credential is sent.

describe('normalizeServerUrl', () => {
  it('defaults a bare public host to https', () => {
    expect(normalizeServerUrl('auth.example.com/')).toBe('https://auth.example.com')
  })

  it('keeps http for local development hosts', () => {
    for (const host of ['localhost:8787', '127.0.0.1:8787', '192.168.1.20', 'box.local', '[::1]:8787']) {
      expect(normalizeServerUrl(host)).toBe(`http://${host}`)
    }
  })

  it('respects an explicit scheme', () => {
    expect(normalizeServerUrl('http://auth.example.com')).toBe('http://auth.example.com')
  })
})

describe('discoverConfig', () => {
  afterEach(() => vi.unstubAllGlobals())

  const serve = (doc: object) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(doc), { status: 200 })))

  it('rejects plaintext endpoints advertised by an https server', async () => {
    serve({ auth: 'http://auth.example.com', spacetimedb: 'wss://chat.example.com', livekit: 'wss://lk.example.com' })
    await expect(discoverConfig('auth.example.com')).rejects.toThrow(/insecure endpoints.*auth/)
  })

  it('accepts secure endpoints', async () => {
    serve({ auth: 'https://auth.example.com', spacetimedb: 'wss://chat.example.com', livekit: 'wss://lk.example.com' })
    await expect(discoverConfig('auth.example.com')).resolves.toMatchObject({ authServiceUrl: 'https://auth.example.com' })
  })
})
