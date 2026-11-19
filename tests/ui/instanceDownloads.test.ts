import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

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
