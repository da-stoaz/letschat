import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it } from 'vitest'

const download = readFileSync('site/src/pages/download.astro', 'utf8')
// The page script imports the cached release lookup; inline the real module
// (minus its own import) so the test runs the code the page ships.
const releaseLookup = readFileSync('site/src/lib/latest-release.ts', 'utf8')
  .replace(/^import .*$/m, 'const GITHUB_REPO = "da-stoaz/letschat";')
  .replace(/^export /gm, '')
const script = download.match(/<script>([\s\S]*?)<\/script>/i)![1]
  .replace(/^\s*import \{ latestRelease \} from .*$/m, releaseLookup)
const keys = ['mac', 'windows-x64-msi', 'windows-x64-exe', 'windows-arm-msi', 'windows-arm-exe', 'linux-deb', 'linux-appimage']
function element() {
  const classes = new Set<string>()
  return { textContent: '', href: '', style: { borderColor: '' },
    attributes: new Map([['aria-disabled', 'true'], ['tabindex', '-1']]),
    removeAttribute(name: string) { this.attributes.delete(name) },
    classList: { add: (...names: string[]) => names.forEach(name => classes.add(name)), remove: (...names: string[]) => names.forEach(name => classes.delete(name)), contains: (name: string) => classes.has(name) },
  }
}
async function releaseFeedback(fail: boolean) {
  const nodes = new Map<string, ReturnType<typeof element>>()
  for (const id of ['release-label', 'release-error', 'card-mac', ...keys, ...keys.map(key => `asset-status-${key}`)]) nodes.set(id, element())
  nodes.get('release-error')!.classList.add('hidden')
  const context = {
    document: {
      getElementById: (id: string) => nodes.get(id),
      querySelector: (selector: string) => selector === '[data-release-label]'
        ? nodes.get('release-label')
        : nodes.get(selector.match(/data-asset="([^"]+)"/)![1]),
      querySelectorAll: (selector: string) => selector === '[data-asset]'
        ? keys.map(key => nodes.get(key))
        : keys.map(key => nodes.get(`asset-status-${key}`)),
    },
    navigator: { userAgent: 'iPhone Mac OS', maxTouchPoints: 5 },
    fetch: async () => { if (fail) throw new Error('Offline'); return { ok: true, json: async () => ({ tag_name: 'test', assets: [{ name: 'client.dmg', browser_download_url: 'https://example.com/client.dmg' }, { name: 'client_arm64_en-US.msi', browser_download_url: 'https://example.com/arm.msi' }, { name: 'client_x64_en-US.msi', browser_download_url: 'https://example.com/x64.msi' }] }) } },
    finished: Promise.resolve(),
  }
  runInNewContext(ts.transpileModule(script.replace('loadRelease();', 'globalThis.finished = loadRelease();'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await context.finished
  return nodes
}

it('keeps unavailable formats disabled and explains missing release assets', async () => {
  expect(download).not.toContain('href="#"')
  const nodes = await releaseFeedback(false)
  expect(nodes.get('mac')!.href).toBe('https://example.com/client.dmg')
  expect(nodes.get('mac')!.attributes.has('aria-disabled')).toBe(false)
  expect(nodes.get('windows-x64-msi')!.href).toBe('https://example.com/x64.msi')
  expect(nodes.get('windows-arm-msi')!.href).toBe('https://example.com/arm.msi')
  expect(nodes.get('linux-deb')!.attributes.get('aria-disabled')).toBe('true')
  expect(nodes.get('asset-status-linux-deb')!.textContent).toContain('Not included')
  expect(nodes.get('card-mac')!.style.borderColor).toBe('')
  expect(nodes.get('release-label')!.textContent).toBe('Version test · ')
  expect(nodes.get('release-error')!.classList.contains('hidden')).toBe(true)
})

it('sends every format to the latest release page when GitHub refuses', async () => {
  const nodes = await releaseFeedback(true)
  for (const key of keys) {
    expect(nodes.get(key)!.href).toBe('https://github.com/da-stoaz/letschat/releases/latest')
    expect(nodes.get(key)!.attributes.has('aria-disabled')).toBe(false)
    expect(nodes.get(`asset-status-${key}`)!.textContent).toBe('')
  }
  expect(nodes.get('release-error')!.classList.contains('hidden')).toBe(false)
  expect(nodes.get('release-label')!.textContent).toBe('')
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
