import { execFileSync } from 'node:child_process'
import { BASE, DB, issuerOf } from './harness'

// Publish the module to the throwaway test database with a clean slate before
// the suite runs. `--delete-data` is safe here ONLY because DB is the dedicated
// test database — we hard-refuse to run against the real `letschat` database.
export default async function setup(): Promise<void> {
  if (DB === 'letschat') {
    throw new Error(
      'Refusing to run the security suite against the real `letschat` database. ' +
        'Set STDB_TEST_DB to a throwaway name.',
    )
  }

  console.log(`\n[security suite] publishing module to ${DB} @ ${BASE} (clean slate)…`)
  // execFileSync so BASE/DB (env-overridable) stay plain argv entries rather
  // than shell input.
  execFileSync(
    'spacetime',
    ['publish', '--server', BASE, DB, '--module-path', 'server', '--delete-data', '--yes'],
    { stdio: 'inherit', cwd: process.cwd() },
  )

  // The module fails closed: nobody can register until an issuer is pinned.
  // Pin SpacetimeDB's own issuer — the one `mintIdentity()` tokens carry — as
  // the module owner, i.e. the CLI identity that just published.
  const res = await fetch(`${BASE}/v1/identity`, { method: 'POST' })
  const { token } = (await res.json()) as { token: string }
  execFileSync(
    'spacetime',
    ['call', '-s', BASE, DB, 'set_trusted_issuer', JSON.stringify({ some: issuerOf(token) })],
    { stdio: 'inherit' },
  )
}
