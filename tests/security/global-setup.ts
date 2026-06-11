import { execSync } from 'node:child_process'
import { BASE, DB } from './harness'

// Publish the module to the throwaway test database with a clean slate before
// the suite runs. `--delete-data` is safe here ONLY because DB is the dedicated
// test database — we hard-refuse to run against the real `letschat` database.
export default function setup(): void {
  if (DB === 'letschat') {
    throw new Error(
      'Refusing to run the security suite against the real `letschat` database. ' +
        'Set STDB_TEST_DB to a throwaway name.',
    )
  }

  console.log(`\n[security suite] publishing module to ${DB} @ ${BASE} (clean slate)…`)
  execSync(
    `spacetime publish --server ${BASE} ${DB} --module-path server --delete-data --yes`,
    { stdio: 'inherit', cwd: process.cwd() },
  )
}
