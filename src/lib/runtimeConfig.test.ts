import { afterEach, describe, expect, it, vi } from 'vitest'

// The web image is built once in CI; the instance address arrives at runtime
// through /config.js, which must win over anything baked in at build time.

const load = async (config: object | undefined, baked?: string) => {
  vi.resetModules()
  vi.stubEnv('VITE_WEB_CONNECT_URL', baked ?? '')
  ;(globalThis as { __LETSCHAT_CONFIG__?: object }).__LETSCHAT_CONFIG__ = config
  return import('./runtimeConfig')
}

describe('runtimeConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete (globalThis as { __LETSCHAT_CONFIG__?: object }).__LETSCHAT_CONFIG__
  })

  it('uses the address the web container wrote', async () => {
    const config = await load({ webConnectUrl: ' https://auth.example.com ', wsCompression: 'none' }, 'https://baked.example.com')
    expect(config.WEB_CONNECT_URL).toBe('https://auth.example.com')
    expect(config.WEB_WS_COMPRESSION).toBe('none')
  })

  it('falls back to a baked-in address for self-built bundles', async () => {
    expect((await load({}, 'https://baked.example.com')).WEB_CONNECT_URL).toBe('https://baked.example.com')
  })

  it('is unset on desktop and dev, where Setup is used', async () => {
    expect((await load(undefined)).WEB_CONNECT_URL).toBeUndefined()
  })
})
