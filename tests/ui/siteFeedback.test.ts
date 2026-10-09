import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it } from 'vitest'

const download = readFileSync('site/src/pages/download.astro', 'utf8')
const script = download.match(/<script>([\s\S]*?)<\/script>/)![1]
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
  for (const id of ['version-badge', 'version-value', 'release-error', 'card-mac', ...keys, ...keys.map(key => `asset-status-${key}`)]) nodes.set(id, element())
  const context = {
    document: {
      getElementById: (id: string) => nodes.get(id),
      querySelector: (selector: string) => nodes.get(selector.match(/data-asset="([^"]+)"/)![1]),
      querySelectorAll: () => keys.map(key => nodes.get(`asset-status-${key}`)),
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
})

it('explains a release fetch failure for every format', async () => {
  const nodes = await releaseFeedback(true)
  for (const key of keys) {
    expect(nodes.get(key)!.href).toBe('')
    expect(nodes.get(`asset-status-${key}`)!.textContent).toContain('Availability unknown')
  }
  expect(nodes.get('version-value')!.textContent).toBe('Release unavailable')
})

it('keeps all desktop choices for mobile and unknown instance visitors', () => {
  const source = readFileSync('core-api/src/CoreApi/Pages/Index.cshtml', 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]
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
