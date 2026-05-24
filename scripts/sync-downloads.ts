#!/usr/bin/env bun
/**
 * Copies built Tauri installers from `src-tauri/target/**\/bundle/` into
 * `core-api/src/CoreApi/wwwroot/downloads/` under stable platform-keyed names
 * (macos-arm64.dmg, macos-universal.dmg, windows-x64.msi, …) so /downloads/{os}
 * can serve them.
 *
 * Run after `bun run tauri:build:local` (or after CI drops artifacts on the host).
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const repoRoot = new URL('..', import.meta.url).pathname
const bundleRoot = join(repoRoot, 'src-tauri', 'target')
const outDir = join(repoRoot, 'core-api', 'src', 'CoreApi', 'wwwroot', 'downloads')

/** First matching file under bundleRoot whose path includes `pathFragment` and ends with `ext`. */
function findArtifact(pathFragment: string, ext: string): string | null {
  const stack: string[] = [bundleRoot]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(dir) } catch { continue }
    for (const entry of entries) {
      const full = join(dir, entry)
      let s
      try { s = statSync(full) } catch { continue }
      if (s.isDirectory()) {
        stack.push(full)
      } else if (full.includes(pathFragment) && full.toLowerCase().endsWith(ext)) {
        return full
      }
    }
  }
  return null
}

mkdirSync(outDir, { recursive: true })

// (bundle path fragment, file extension, destination name)
const targets: Array<[string, string, string]> = [
  ['/universal-apple-darwin/release/bundle/dmg/', '.dmg', 'macos-universal.dmg'],
  ['/aarch64-apple-darwin/release/bundle/dmg/', '.dmg', 'macos-arm64.dmg'],
  ['/x86_64-apple-darwin/release/bundle/dmg/', '.dmg', 'macos-x64.dmg'],
  ['/release/bundle/dmg/', '.dmg', 'macos-arm64.dmg'], // host-arch fallback (covers `tauri build` on M-series)
  ['/release/bundle/msi/', '.msi', 'windows-x64.msi'],
  ['/release/bundle/nsis/', '.exe', 'windows-x64.exe'],
  ['/release/bundle/appimage/', '.appimage', 'linux-x64.AppImage'],
  ['/release/bundle/deb/', '.deb', 'linux-x64.deb'],
]

let copied = 0
for (const [fragment, ext, destName] of targets) {
  const dest = join(outDir, destName)
  if (existsSync(dest)) continue // do not clobber an existing newer artifact

  const source = findArtifact(fragment, ext)
  if (!source) continue
  copyFileSync(source, dest)
  console.log(`✓ ${basename(source)} → wwwroot/downloads/${destName}`)
  copied += 1
}

if (copied === 0) {
  console.log('No new installer artifacts found in src-tauri/target. Run `bun run tauri:build:local` first, or delete files in wwwroot/downloads/ to re-sync.')
} else {
  console.log(`\nSynced ${copied} installer(s) into wwwroot/downloads/.`)
}
