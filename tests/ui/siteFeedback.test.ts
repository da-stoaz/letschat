import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { downloadUrl, latestRelease } from '../../site/src/lib/latest-release'

const RELEASE_PAGE = 'https://github.com/da-stoaz/letschat/releases/latest'
const release = {
  tag_name: 'v9.9.9',
  assets: [
    { name: 'LetsChat_9.9.9_universal.dmg', browser_download_url: 'https://example.com/mac.dmg' },
    { name: 'LetsChat_9.9.9_x64_en-US.msi', browser_download_url: 'https://example.com/x64.msi' },
    { name: 'LetsChat_9.9.9_arm64_en-US.msi', browser_download_url: 'https://example.com/arm.msi' },
  ],
}

afterEach(() => vi.unstubAllGlobals())

it('links each format to its file, and anything missing to the release page', () => {
  expect(downloadUrl(release, 'mac')).toBe('https://example.com/mac.dmg')
  expect(downloadUrl(release, 'windows-x64-msi')).toBe('https://example.com/x64.msi')
  expect(downloadUrl(release, 'windows-arm-msi')).toBe('https://example.com/arm.msi')
  expect(downloadUrl(release, 'linux-deb')).toBe(RELEASE_PAGE)
  expect(downloadUrl(null, 'mac')).toBe(RELEASE_PAGE)
})

it('resolves null rather than throwing when GitHub or storage fails', async () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
  for (const fetch of [
    async () => { throw new Error('offline') },
    async () => ({ ok: false, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ message: 'API rate limit exceeded' }) }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json') } }),
  ]) {
    vi.stubGlobal('fetch', fetch)
    expect(await latestRelease()).toBeNull()
  }
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => release }))
  expect(await latestRelease()).toEqual(release)
})

it('serves a fresh cached release without asking GitHub, and ignores a malformed one', async () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
  const fetch = vi.fn(async () => ({ ok: true, json: async () => release }))
  vi.stubGlobal('fetch', fetch)
  await latestRelease()
  expect(await latestRelease()).toEqual(release)
  expect(fetch).toHaveBeenCalledTimes(1)
  store.set('letschat:latest-release', JSON.stringify({ at: Date.now(), release: { tag_name: 1 } }))
  expect(await latestRelease()).toEqual(release)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('keeps all desktop choices for mobile and unknown instance visitors', () => {
  const source = readFileSync('core-api/src/CoreApi/Pages/_Downloads.cshtml', 'utf8').match(/<script>([\s\S]*?)<\/script>/i)![1]
  for (const [userAgent, touches, expected] of [
    ['iPhone Mac OS', 5, null], ['Android Linux', 5, null], ['Macintosh', 5, null],
    ['Unknown', 0, null], ['Macintosh', 0, 'macos'], ['Windows NT', 0, 'windows'], ['Linux x86_64', 0, 'linux'],
  ] as const) {
    const selected: string[] = []
    runInNewContext(source, {
      navigator: { userAgent, maxTouchPoints: touches },
      document: { querySelector: (selector: string) => ({ classList: { add: () => selected.push(selector) } }) },
    })
    expect(selected).toEqual(expected ? [`[data-download="${expected}"]`] : [])
  }
})
