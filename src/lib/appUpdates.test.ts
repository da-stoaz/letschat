import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { checkAppUpdate, installAppUpdate, openUrl, toast } = vi.hoisted(() => ({
  checkAppUpdate: vi.fn(),
  installAppUpdate: vi.fn(),
  openUrl: vi.fn(),
  toast: Object.assign(vi.fn(), { loading: vi.fn(), error: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast }))
vi.mock('./tauri', () => ({ tauriCommands: { checkAppUpdate, installAppUpdate, openUrl } }))
vi.mock('./clientCompatibility', () => ({ CLIENT_VERSION: '1.6.4' }))

import { recommendedAppVersion, watchForAppUpdates } from './appUpdates'
import { useServerConfigStore, type ServerConfig } from '../stores/serverConfigStore'

type Action = { label: string; onClick: () => void }
const actionOf = (mock: { mock: { calls: unknown[][] } }) => (mock.mock.calls.at(-1)![1] as { action: Action }).action
const host = (name: string): ServerConfig => ({ discoveryUrl: `https://${name}`, authServiceUrl: `https://auth.${name}`,
  spacetimedbUri: `wss://${name}`, livekitUrl: `wss://lk.${name}`, spacetimedbDatabase: 'letschat' })
/** What each saved server's discovery document recommends; `null` is an unreachable server. */
let recommended: Record<string, unknown>
const save = (...names: string[]) => useServerConfigStore.setState({ knownHosts: names.map(host) })
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('desktop updates follow the saved servers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recommended = {}
    save()
    checkAppUpdate.mockImplementation(async (version: string) => version)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const name = new URL(url).host
      expect(url).toBe(`https://${name}/.well-known/letschat.json`)
      if (recommended[name] === null) throw new Error('offline')
      return new Response(JSON.stringify({ recommendedClient: recommended[name] }))
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('recommends the newest valid version of all reachable servers', async () => {
    recommended = { old: '1.6.2', lagging: '1.7.0', newest: '1.10.0', down: null, junk: 'latest', path: '9.9.9/../x', none: undefined, number: 99 }
    expect(await recommendedAppVersion(Object.keys(recommended).map(host))).toBe('1.10.0')
    expect(await recommendedAppVersion([host('down'), host('junk')])).toBeNull()
    expect(await recommendedAppVersion([])).toBeNull()
  })

  it('stays on the version of a server that lags behind the newest release', async () => {
    recommended = { lagging: '1.6.4' }
    save('lagging')
    const stop = watchForAppUpdates()
    await settle()
    expect(checkAppUpdate).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    stop()
  })

  it('never offers a downgrade or an update without a saved server', async () => {
    const stop = watchForAppUpdates()
    await settle()
    recommended = { older: '1.5.0' }
    save('older')
    await settle()
    expect(fetch).toHaveBeenCalledOnce()
    expect(checkAppUpdate).not.toHaveBeenCalled()
    stop()
  })

  it('offers exactly the recommended release and installs only when the user restarts', async () => {
    recommended = { lagging: '1.6.2', upgraded: '1.7.0' }
    save('lagging', 'upgraded')
    const stop = watchForAppUpdates()
    await vi.waitFor(() => expect(toast).toHaveBeenCalledOnce())
    expect(checkAppUpdate).toHaveBeenCalledExactlyOnceWith('1.7.0')
    expect(toast.mock.calls[0][0]).toBe('LetsChat 1.7.0 is available')
    expect(installAppUpdate).not.toHaveBeenCalled()
    installAppUpdate.mockResolvedValue(undefined)
    actionOf(toast).onClick()
    expect(installAppUpdate).toHaveBeenCalledOnce()
    await settle()
    expect(toast.error).not.toHaveBeenCalled()
    stop()
  })

  it('checks again when a server is saved, and is quiet when that release cannot be installed', async () => {
    recommended = { first: '1.6.4', second: '1.8.0' }
    save('first')
    const stop = watchForAppUpdates()
    await settle()
    checkAppUpdate.mockResolvedValueOnce(null) // not newer for the native side, or no build for this platform
    save('second', 'first')
    await vi.waitFor(() => expect(checkAppUpdate).toHaveBeenCalledExactlyOnceWith('1.8.0'))
    checkAppUpdate.mockRejectedValueOnce(new Error('404: release is still a draft'))
    save('first', 'second')
    await vi.waitFor(() => expect(checkAppUpdate).toHaveBeenCalledTimes(2))
    await settle()
    expect(toast).not.toHaveBeenCalled()
    stop()
  })

  it('falls back to that release\'s download page when installing fails', async () => {
    recommended = { upgraded: '1.7.0' }
    save('upgraded')
    installAppUpdate.mockRejectedValue(new Error('signature mismatch'))
    const stop = watchForAppUpdates()
    await vi.waitFor(() => expect(toast).toHaveBeenCalledOnce())
    actionOf(toast).onClick()
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce())
    actionOf(toast.error).onClick()
    expect(openUrl).toHaveBeenCalledWith('https://github.com/da-stoaz/letschat/releases/tag/v1.7.0')
    stop()
  })

  it('rechecks every six hours', async () => {
    vi.useFakeTimers()
    try {
      recommended = { server: '1.6.4' }
      save('server')
      const stop = watchForAppUpdates()
      await vi.advanceTimersByTimeAsync(0)
      recommended = { server: '1.7.0' } // the operator upgraded while the app sat in the tray
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
      expect(checkAppUpdate).toHaveBeenCalledExactlyOnceWith('1.7.0')
      expect(toast).toHaveBeenCalledOnce()
      stop()
    } finally { vi.useRealTimers() }
  })

  it('stays quiet after cleanup (StrictMode remount) and stops watching', async () => {
    recommended = { upgraded: '1.7.0' }
    save('upgraded')
    watchForAppUpdates()()
    await settle()
    expect(toast).not.toHaveBeenCalled()
    const calls = checkAppUpdate.mock.calls.length
    save('upgraded', 'another')
    await settle()
    expect(checkAppUpdate).toHaveBeenCalledTimes(calls)
  })
})
