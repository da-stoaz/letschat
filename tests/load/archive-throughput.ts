// Load test: sustained message throughput → cold-archive replication fidelity.
//
// Drives `send_message` directly over the same HTTP surface a real client uses
// (via the security harness), at high concurrency, then asserts EVERY message
// reached the PostgreSQL cold archive — i.e. the live CDC worker keeps up under
// load with zero loss. Backend-only on purpose: the UI is not what's under test,
// the replication pipeline is (send_message → archive_* view → worker → Postgres).
//
// Prereqs: dev services up, module published to `letschat`, and the archive
// worker RUNNING with its identity registered (see README). Purely additive —
// creates a throwaway user/server/channel and deletes the server at the end.
//
// Run:  STDB_TEST_DB=letschat bun tests/load/archive-throughput.ts
// Tune: TOTAL, CONCURRENCY, LAG_TIMEOUT_MS via env.

import { execSync } from 'node:child_process'
import { makeUser, createServer, createChannel } from '../security/harness'

const TOTAL = Number(process.env.TOTAL ?? 10_000)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 64)
const LAG_TIMEOUT_MS = Number(process.env.LAG_TIMEOUT_MS ?? 120_000)
const PG_CONTAINER = process.env.PG_CONTAINER ?? 'letschat-dev-postgres'
const ARCHIVE_DB = process.env.ARCHIVE_PG_DATABASE ?? 'archive'

const runId = Date.now().toString(36)
const marker = `lt-${runId}-`

/** Count archived messages from this run (verbatim content match). */
function archiveCount(): number {
  const sql = `SELECT count(*) FROM archive_message WHERE content LIKE '${marker}%'`
  const out = execSync(
    `docker exec ${PG_CONTAINER} psql -U letschat -d ${ARCHIVE_DB} -tAc "${sql}"`,
  )
    .toString()
    .trim()
  return Number(out)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  console.log(`[load] run ${runId}: ${TOTAL} messages @ concurrency ${CONCURRENCY}`)

  const user = await makeUser('load')
  const serverId = await createServer(user)
  const channelId = await createChannel(user, serverId)
  console.log(`[load] channel ${channelId} ready; archive baseline for this run: ${archiveCount()}`)

  // ── Send phase: CONCURRENCY parallel senders drain a shared counter. ──
  let next = 0
  let ok = 0
  let fail = 0
  const firstError = { msg: '' }

  const sendWorker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= TOTAL) return
      try {
        await user.call('send_message', [channelId, `${marker}${i}`])
        ok++
      } catch (e) {
        fail++
        if (!firstError.msg) firstError.msg = e instanceof Error ? e.message : String(e)
      }
    }
  }

  const sendStart = performance.now()
  await Promise.all(Array.from({ length: CONCURRENCY }, sendWorker))
  const sendMs = performance.now() - sendStart
  const sendRate = (ok / sendMs) * 1000
  const lastSentAt = performance.now()

  console.log(
    `[load] sent ${ok}/${TOTAL} in ${(sendMs / 1000).toFixed(1)}s ` +
      `= ${sendRate.toFixed(0)} msg/s (${fail} failed)`,
  )
  if (fail > 0) console.log(`[load] first send error: ${firstError.msg}`)

  // ── Catch-up phase: poll the archive until it has every sent message. ──
  let replicated = archiveCount()
  while (replicated < ok && performance.now() - lastSentAt < LAG_TIMEOUT_MS) {
    await sleep(200)
    replicated = archiveCount()
  }
  const lagMs = performance.now() - lastSentAt

  console.log(
    `[load] archive replicated ${replicated}/${ok}; ` +
      `catch-up lag after last send: ${(lagMs / 1000).toFixed(1)}s`,
  )

  // ── Cleanup: drop the throwaway server (cascades; worker mirrors deletes). ──
  try {
    await user.call('delete_server', [serverId])
    console.log('[load] cleanup: test server deleted')
  } catch (e) {
    console.log(`[load] cleanup WARN: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── Verdict ──
  const rateOk = sendRate >= 100
  const lossOk = replicated === ok && ok === TOTAL
  console.log(
    `\n[load] RESULT: throughput ${sendRate.toFixed(0)} msg/s ` +
      `(${rateOk ? 'PASS ≥100' : 'FAIL <100'}), ` +
      `replication ${replicated}/${TOTAL} (${lossOk ? 'PASS zero-loss' : 'FAIL'})`,
  )
  process.exit(rateOk && lossOk ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
