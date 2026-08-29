import { describe, it, expect, beforeAll } from 'vitest'
import {
  createChannel,
  createServer,
  makeAdmin,
  makeUser,
  none,
  ownerSql,
  timestamp,
  type TestUser,
} from './harness'

// Regression tests for the archive-rebuild id collision.
//
// A rebuild restores rows verbatim with their original ids, but an explicit
// insert does NOT advance SpacetimeDB's auto-inc sequence and there is no API
// to set one. So after a rebuild the sequence still points into the range the
// restored rows already occupy, and the next organic insert panics the reducer
// with "duplicate unique column" — the client sees HTTP 530.
//
// The module fixes this by owning id allocation itself (`IdCounter`): a restore
// raises the counter past the ids it restored, and inserts allocate from the
// counter instead of the stale sequence.
//
// The tests below reproduce the collision faithfully by restoring a row at
// EXACTLY the id the sequence would hand out next (derived empirically from a
// real insert). Restoring at some arbitrary far-away id would not collide and
// would pass even against the unfixed module.

async function sendMessage(user: TestUser, channelId: number, content: string): Promise<number> {
  await user.call('send_message', [channelId, content])
  const { rows } = await user.sql('SELECT id, content FROM my_channel_messages')
  const row = rows.find((r) => r.content === content)
  if (!row) throw new Error(`sent message "${content}" not visible in my_channel_messages`)
  return Number(row.id)
}

/** Restore one `message` row verbatim, as the rebuild worker does. */
async function restoreMessage(
  worker: TestUser,
  row: { id: number; channelId: number; sender: TestUser; content: string },
): Promise<void> {
  await worker.call('archive_restore_message', [
    [[row.id, row.channelId, row.sender.idArg, row.content, timestamp(Date.now() * 1000), none, false]],
  ])
}

function counterFor(tableName: string): number | null {
  const out = ownerSql(`SELECT next_id FROM id_counter WHERE table_name = '${tableName}'`)
  const match = out.match(/\b(\d+)\s*$/m)
  return match ? Number(match[1]) : null
}

describe('archive rebuild — id allocation', () => {
  let worker: TestUser
  let owner: TestUser
  let channelId: number

  beforeAll(async () => {
    const admin = await makeAdmin()
    worker = await makeUser('wrk')
    await admin.call('set_archive_service_identity', [worker.idArg])

    owner = await makeUser('own')
    channelId = await createChannel(owner, await createServer(owner))
  })

  it('an organic insert does not collide with a restored row', async () => {
    // The id the auto-inc sequence would hand out next is exactly one past the
    // id this insert just consumed — so a restored row placed there is the
    // collision the bug report describes.
    const lastOrganicId = await sendMessage(owner, channelId, 'before rebuild')
    const restoredId = lastOrganicId + 1

    await restoreMessage(worker, {
      id: restoredId,
      channelId,
      sender: owner,
      content: 'restored row',
    })

    // Against the unfixed module this call panics the reducer (HTTP 530).
    const nextOrganicId = await sendMessage(owner, channelId, 'after rebuild')

    expect(nextOrganicId).toBeGreaterThan(restoredId)

    // The restored row must survive untouched — a collision that overwrote it
    // would be silent data loss.
    const { rows } = await owner.sql('SELECT id, content FROM my_channel_messages')
    const restored = rows.find((r) => Number(r.id) === restoredId)
    expect(restored?.content).toBe('restored row')
  })

  it('reseeds counters for an instance rebuilt before counters existed', async () => {
    // An instance rebuilt by the older tooling has restored rows but no
    // counter, so allocation would fall back to the stale sequence. Dropping
    // the counter row reproduces that state exactly.
    const restoredId = (await sendMessage(owner, channelId, 'pre-repair')) + 5000
    await restoreMessage(worker, {
      id: restoredId,
      channelId,
      sender: owner,
      content: 'legacy restored row',
    })
    ownerSql("DELETE FROM id_counter WHERE table_name = 'message'")
    expect(counterFor('message')).toBeNull()

    await worker.call('archive_reseed_id_counters', [])

    // Repaired counter must clear every id present, not just the ones this
    // test restored.
    expect(counterFor('message')).toBe(restoredId + 1)
    expect(await sendMessage(owner, channelId, 'post-repair')).toBe(restoredId + 1)
  })

  it('leaves a never-rebuilt table on auto-inc', async () => {
    // No restore has touched `dm_server_invite`, so it must have no counter and
    // keep using the stock sequence — the fix is inert until a rebuild needs it.
    expect(counterFor('dm_server_invite')).toBeNull()
  })
})
