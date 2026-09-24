import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  BASE,
  DB,
  createChannel,
  createServer,
  makeAdmin,
  makeFriends,
  makeUser,
  none,
  ownerSql,
  some,
  timestamp,
  type TestUser,
} from './harness'

const SENTINEL = '__letschat_cleanup_authorized__'

function attachmentContent(storageKey: string): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, attachments: [{ storageKey }] }),
  ).toString('base64url')
  return `attachment\n\n[[LC_ATTACHMENTS_V1:${payload}]]`
}

async function claim(admin: TestUser, storageKey: string): Promise<string[]> {
  const batchId = randomBytes(16).toString('hex')
  await admin.call('claim_unreferenced_storage', [batchId, [storageKey]])
  const result = await admin.sql(
    `SELECT storage_key FROM storage_deletion_claims_for_cleanup WHERE batch_id = '${batchId}'`,
  )
  if (result.error) throw new Error(result.error)
  const keys = result.rows.map((row) => String(row.storage_key))
  if (!keys.includes(SENTINEL)) throw new Error('cleanup authorization sentinel missing')
  return keys.filter((key) => key !== SENTINEL)
}

async function sentMessageId(user: TestUser, content: string): Promise<number> {
  const result = await user.sql('SELECT id, content FROM my_channel_messages')
  const row = result.rows.find((candidate) => candidate.content === content)
  if (!row) throw new Error('sent channel message is not visible')
  return Number(row.id)
}

async function sentDirectMessageId(user: TestUser, content: string): Promise<number> {
  const result = await user.sql('SELECT id, content FROM my_direct_messages')
  const row = result.rows.find((candidate) => candidate.content === content)
  if (!row) throw new Error('sent direct message is not visible')
  return Number(row.id)
}

describe('object-storage reference lifecycle', () => {
  let admin: TestUser
  let owner: TestUser
  let partner: TestUser
  let serverId: number
  let channelId: number

  beforeAll(async () => {
    admin = await makeAdmin('storage_admin')
    owner = await makeUser('storage_owner')
    partner = await makeUser('storage_partner')
    serverId = await createServer(owner)
    channelId = await createChannel(owner, serverId)
    await makeFriends(owner, partner)

    // A collector may only claim after the derived reference index has been
    // rebuilt at least once. This is also the additive-upgrade safety gate.
    // Earlier files restore archive rows, which fences rebuilds for a quiet
    // period; this suite starts from a settled module.
    ownerSql('DELETE FROM storage_restore_fence')
    await admin.call('rebuild_storage_references')
  })

  it('protects a channel attachment until its message is deleted', async () => {
    const key = `uploads/ch/${channelId}/${owner.username}/channel.bin`
    const replacementKey = `uploads/ch/${channelId}/${owner.username}/replacement.bin`
    const content = attachmentContent(key)
    await owner.call('send_message', [channelId, content])
    const messageId = await sentMessageId(owner, content)

    expect(await claim(admin, key)).not.toContain(key)

    await owner.call('edit_message', [messageId, attachmentContent(replacementKey)])
    expect(await claim(admin, key)).toContain(key)
    expect(await claim(admin, replacementKey)).not.toContain(replacementKey)

    await owner.call('delete_message', [messageId])
    expect(await claim(admin, replacementKey)).toContain(replacementKey)
    await expect(owner.call('send_message', [channelId, content])).rejects.toThrow(
      'attachment upload expired',
    )
  })

  it('keeps a DM attachment until both participants delete the message', async () => {
    const key = `uploads/dm/${owner.username}/${partner.username}/direct.bin`
    const content = attachmentContent(key)
    await owner.call('send_direct_message', [partner.idArg, content])
    const messageId = await sentDirectMessageId(owner, content)

    expect(await claim(admin, key)).not.toContain(key)
    await owner.call('delete_direct_message', [messageId])
    expect(await claim(admin, key)).not.toContain(key)

    await partner.call('delete_direct_message', [messageId])
    expect(await claim(admin, key)).toContain(key)
    await expect(owner.call('send_direct_message', [partner.idArg, content])).rejects.toThrow(
      'attachment upload expired',
    )
  })

  it('tracks avatar replacement and blocks a claimed avatar from returning', async () => {
    const key = `uploads/avatar/${owner.username}/avatar.png`
    const replacementKey = `uploads/avatar/${owner.username}/replacement.png`
    await owner.call('update_profile', [none, some(key)])
    expect(await claim(admin, key)).not.toContain(key)

    await owner.call('update_profile', [none, some(replacementKey)])
    expect(await claim(admin, key)).toContain(key)
    expect(await claim(admin, replacementKey)).not.toContain(replacementKey)

    await owner.call('update_profile', [none, some('')])
    expect(await claim(admin, replacementKey)).toContain(replacementKey)
    await expect(owner.call('update_profile', [none, some(key)])).rejects.toThrow(
      'attachment upload expired',
    )
  })

  it('tracks space-icon removal and blocks a claimed icon from returning', async () => {
    const key = `uploads/icon/${serverId}/${owner.username}/icon.png`
    const replacementKey = `uploads/icon/${serverId}/${owner.username}/replacement.png`
    await owner.call('set_server_icon', [serverId, some(key)])
    expect(await claim(admin, key)).not.toContain(key)

    await owner.call('set_server_icon', [serverId, some(replacementKey)])
    expect(await claim(admin, key)).toContain(key)
    expect(await claim(admin, replacementKey)).not.toContain(replacementKey)

    await owner.call('set_server_icon', [serverId, none])
    expect(await claim(admin, replacementKey)).toContain(replacementKey)
    await expect(owner.call('set_server_icon', [serverId, some(key)])).rejects.toThrow(
      'attachment upload expired',
    )
  })

  it('accepts only scoped keys for new avatars and icons (A16)', async () => {
    // A legacy key is not size- or type-limited at upload time, so it could
    // put a 500 MiB non-image in front of everyone who renders the avatar.
    const legacy = `uploads/2026/09/24/${owner.username}/huge.bin`
    await expect(owner.call('update_profile', [none, some(legacy)])).rejects.toThrow(
      'avatar storage key does not belong to this account',
    )
    await expect(owner.call('set_server_icon', [serverId, some(legacy)])).rejects.toThrow(
      'space icon storage key does not belong to this space',
    )
  })

  it('removes references when a channel or its whole space is deleted', async () => {
    const cascadeServerId = await createServer(owner)
    const removedChannelId = await createChannel(owner, cascadeServerId)
    const removedChannelKey =
      `uploads/ch/${removedChannelId}/${owner.username}/deleted-channel.bin`
    await owner.call('send_message', [removedChannelId, attachmentContent(removedChannelKey)])
    await owner.call('delete_channel', [removedChannelId])
    expect(await claim(admin, removedChannelKey)).toContain(removedChannelKey)

    const cascadedChannelId = await createChannel(owner, cascadeServerId)
    const cascadedMessageKey =
      `uploads/ch/${cascadedChannelId}/${owner.username}/deleted-space.bin`
    const cascadedIconKey =
      `uploads/icon/${cascadeServerId}/${owner.username}/deleted-space.png`
    await owner.call('send_message', [cascadedChannelId, attachmentContent(cascadedMessageKey)])
    await owner.call('set_server_icon', [cascadeServerId, some(cascadedIconKey)])
    await owner.call('delete_server', [cascadeServerId])

    expect(await claim(admin, cascadedMessageKey)).toContain(cascadedMessageKey)
    expect(await claim(admin, cascadedIconKey)).toContain(cascadedIconKey)
  })

  it('fences cleanup while an archive restore is in flight', async () => {
    const worker = await makeUser('storage_worker')
    await admin.call('set_archive_service_identity', [worker.idArg])
    const liveKey = `uploads/ch/${channelId}/${owner.username}/restored.bin`
    const collectedKey = `uploads/ch/${channelId}/${owner.username}/collected.bin`
    expect(await claim(admin, collectedKey)).toContain(collectedKey)

    // A restored row may name an already-collected object; that must not
    // abort the whole restore batch.
    const restoredId = 900_000_000 + Math.floor(Math.random() * 1_000_000)
    const restore = (id: number, key: string) => worker.call('archive_restore_message', [
      [[id, channelId, owner.idArg, attachmentContent(key), timestamp(Date.now() * 1000), none, false]],
    ])
    await restore(restoredId, liveKey)
    await restore(restoredId + 1, collectedKey)

    // Mid-restore: no claims, and no rebuild that would miss later batches.
    await expect(admin.call('claim_unreferenced_storage', [randomBytes(16).toString('hex'), [liveKey]]))
      .rejects.toThrow('storage references are not ready')
    await expect(admin.call('rebuild_storage_references')).rejects.toThrow('archive restore in progress')

    ownerSql('DELETE FROM storage_restore_fence') // stands in for the quiet period
    await admin.call('rebuild_storage_references')
    expect(await claim(admin, liveKey)).not.toContain(liveKey)
  })

  it('keeps cleanup admin-only and rejects malformed batches', async () => {
    await expect(owner.call('rebuild_storage_references')).rejects.toThrow()
    await expect(owner.call('claim_unreferenced_storage', [randomBytes(16).toString('hex'), []]))
      .rejects.toThrow()
    const hidden = await owner.sql('SELECT storage_key FROM storage_deletion_claims_for_cleanup')
    expect(hidden.error).toBeNull()
    expect(hidden.rows).toHaveLength(0)

    await expect(admin.call('claim_unreferenced_storage', ['not-a-batch-id', []])).rejects.toThrow(
      'invalid storage cleanup batch id',
    )

    const revokedAdmin = await makeAdmin('storage_revoked')
    ownerSql(`UPDATE user SET is_admin = false WHERE identity = 0x${revokedAdmin.identity}`)
    await expect(
      revokedAdmin.call('claim_unreferenced_storage', [randomBytes(16).toString('hex'), []]),
    ).rejects.toThrow()
    const revokedView = await revokedAdmin.sql(
      'SELECT storage_key FROM storage_deletion_claims_for_cleanup',
    )
    expect(revokedView.error).toBeNull()
    expect(revokedView.rows).toHaveLength(0)
  })
})

// BUG_ANALYSIS D7: `--delete-data` re-runs `init` on empty tables. A rebuild
// right then would find no references and let the collector delete every
// attachment before the archive restore starts, so `init` fences until a
// restore batch or an explicit release. Needs its own freshly published
// database, because earlier files have already replaced the shared one's fence.
describe('fresh database storage fence', () => {
  const freshDb = `${DB}fence`
  const asOwner = (...args: string[]) =>
    execFileSync('spacetime', ['call', '-s', BASE, freshDb, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

  it('refuses a rebuild until the init fence is released', () => {
    execFileSync(
      'spacetime',
      ['publish', '--server', BASE, freshDb, '--module-path', 'server', '--delete-data', '--yes'],
      { stdio: 'ignore' },
    )
    try {
      expect(() => asOwner('rebuild_storage_references')).toThrow(/freshly initialized/)
      // Objects older than `init` mean a wipe under live attachments: stay fenced.
      const hourAgoMicros = (Date.now() - 3_600_000) * 1000
      expect(() => asOwner('release_storage_init_fence', JSON.stringify({ some: [hourAgoMicros] })))
        .toThrow(/predate this database/)
      expect(() => asOwner('rebuild_storage_references')).toThrow(/freshly initialized/)
      // Only objects uploaded since `init`: a fresh install, nothing to lose.
      asOwner('release_storage_init_fence', JSON.stringify({ some: [Date.now() * 1000] }))
      expect(() => asOwner('rebuild_storage_references')).not.toThrow()
    } finally {
      execFileSync('spacetime', ['delete', '-s', BASE, freshDb, '--yes'], { stdio: 'ignore' })
    }
  }, 120_000)
})
