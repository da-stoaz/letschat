#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function bumpVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump
  const [major, minor, patch] = current.split('.').map(Number)
  switch (bump) {
    case 'major': return `${major + 1}.0.0`
    case 'minor': return `${major}.${minor + 1}.0`
    case 'patch': return `${major}.${minor}.${patch + 1}`
    default: throw new Error(`Unknown bump type "${bump}". Use: patch | minor | major | x.y.z`)
  }
}

function updateCargoToml(filePath: string, newVersion: string) {
  const lines = readFileSync(filePath, 'utf-8').split('\n')
  let inPackageSection = false
  let replaced = false
  const updated = lines.map(line => {
    if (/^\[/.test(line)) inPackageSection = line.startsWith('[package]')
    if (inPackageSection && !replaced && /^version\s*=/.test(line)) {
      replaced = true
      return line.replace(/"[^"]*"/, `"${newVersion}"`)
    }
    return line
  })
  if (!replaced) throw new Error(`No version field found in [package] section of ${filePath}`)
  writeFileSync(filePath, updated.join('\n'))
}

function updateCsproj(filePath: string, newVersion: string) {
  const content = readFileSync(filePath, 'utf-8')
  if (!/<Version>[^<]*<\/Version>/.test(content)) {
    throw new Error(`No <Version> element found in ${filePath}`)
  }
  writeFileSync(filePath, content.replace(/<Version>[^<]*<\/Version>/, `<Version>${newVersion}</Version>`))
}

const bump = process.argv[2] ?? 'patch'

const pkgPath = join(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const oldVersion: string = pkg.version
const newVersion = bumpVersion(oldVersion, bump)

pkg.version = newVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

const cargoFiles = [
  'src-tauri/Cargo.toml',
  'server/Cargo.toml',
]

for (const rel of cargoFiles) {
  updateCargoToml(join(ROOT, rel), newVersion)
}

const csprojFiles = [
  'core-api/src/CoreApi/CoreApi.csproj',
]

for (const rel of csprojFiles) {
  updateCsproj(join(ROOT, rel), newVersion)
}

console.log(`v${oldVersion} → v${newVersion}`)
console.log('Updated:')
console.log('  package.json')
for (const rel of cargoFiles) console.log(`  ${rel}`)
for (const rel of csprojFiles) console.log(`  ${rel}`)
