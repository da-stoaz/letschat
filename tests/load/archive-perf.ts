// Performance test: latency + scaling characteristics of the message path and
// the cold-archive replication. Complements archive-throughput.ts (which proves
// zero-loss); this one characterises *how fast*.
//
// Three measurements:
//   1. send_message latency distribution (p50/p95/p99/max) at low concurrency.
//   2. Throughput vs concurrency sweep — where send_message saturates.
//   3. End-to-end replication freshness — send → visible in Postgres, sampled
//      with a low-latency direct pg connection (not docker-exec psql).
//
// Prereqs: same as archive-throughput.ts (services up, module published, worker
// running + registered). Purely additive; deletes its throwaway server at the end.
//
// Run: STDB_TEST_DB=letschat bun tests/load/archive-perf.ts

import { SQL } from 'bun'
import { makeUser, createServer, createChannel, type TestUser } from '../security/harness'

const PG_URL = process.env.ARCHIVE_PG_URL ?? 'postgres://letschat:letschat@localhost:5433/archive'
const runId = Date.now().toString(36)
const marker = (i: number | string) => `perf-${runId}-${i}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function summarise(label: string, latencies: number[]): void {
  const s = [...latencies].sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  console.log(
    `  ${label.padEnd(18)} n=${s.length}  ` +
      `mean=${mean.toFixed(1)}ms  p50=${pct(s, 50).toFixed(1)}  ` +
      `p95=${pct(s, 95).toFixed(1)}  p99=${pct(s, 99).toFixed(1)}  max=${s[s.length - 1].toFixed(1)}ms`,
  )
}

/** Send `count` messages at a given concurrency; return per-call latencies (ms). */
async function sendBatch(
  user: TestUser,
  channelId: number,
  prefix: string,
  count: number,
  concurrency: number,
): Promise<number[]> {
  const latencies = new Array<number>(count)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= count) return
      const t0 = performance.now()
      await user.call('send_message', [channelId, `${prefix}-${i}`])
      latencies[i] = performance.now() - t0
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return latencies
}

async function main(): Promise<void> {
  const db = new SQL(PG_URL)
  const user = await makeUser('perf')
  const serverId = await createServer(user)
  const channelId = await createChannel(user, serverId)
  console.log(`[perf] run ${runId}, channel ${channelId}\n`)

  // ── 1 & 2. Throughput vs concurrency, with latency distribution per level. ──
  console.log('[perf] throughput vs concurrency (500 msgs/level):')
  const BATCH = 500
  for (const c of [1, 8, 32, 64, 128]) {
    const t0 = performance.now()
    const lat = await sendBatch(user, channelId, marker(`c${c}`), BATCH, c)
    const secs = (performance.now() - t0) / 1000
    console.log(`  concurrency=${String(c).padStart(3)}  ${(BATCH / secs).toFixed(0).padStart(5)} msg/s`)
    summarise(`   └ latency`, lat)
  }

  // ── 3. End-to-end replication freshness (send → visible in archive). ──
  // Concurrency 1, tight poll on a direct pg connection so the measurement
  // resolves the real propagation time rather than poll/exec overhead.
  console.log('\n[perf] end-to-end replication latency (50 samples, serial):')
  const e2e: number[] = []
  for (let i = 0; i < 50; i++) {
    const content = marker(`e2e-${i}`)
    const t0 = performance.now()
    await user.call('send_message', [channelId, content])
    for (;;) {
      const rows = await db`SELECT 1 FROM archive_message WHERE content = ${content} LIMIT 1`
      if (rows.length > 0) break
      if (performance.now() - t0 > 10_000) throw new Error(`e2e timeout for ${content}`)
      await sleep(2)
    }
    e2e.push(performance.now() - t0)
  }
  summarise('  send→archive', e2e)

  // ── Cleanup ──
  try {
    await user.call('delete_server', [serverId])
    console.log('\n[perf] cleanup: test server deleted')
  } catch (e) {
    console.log(`\n[perf] cleanup WARN: ${e instanceof Error ? e.message : String(e)}`)
  }
  await db.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
