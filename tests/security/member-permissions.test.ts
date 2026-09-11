import { describe, it, expect } from 'vitest'
import {
  createServer,
  makeFriends,
  makeOpenJoinable,
  makeUser,
  none,
  uniqueName,
  variant,
} from './harness'

// Three gaps that all let someone reach past a check the neighbouring reducer
// already made (BUG_ANALYSIS B1, B2, B3).
//
// B1/B2 are the same shape: a reducer that removes or demotes a member never
// asked whether the target was the caller. An owner naming themselves deletes
// or demotes their own `ServerMember` row, and since every owner gate reads
// that row, the space becomes permanently unadministerable — no rename, no
// delete, no transfer, and after `ban_member` not even a way back in by invite.
//
// B3 is the same omission in the DM path: `send_direct_message` checks blocks
// and friendship, `edit_direct_message` checked neither, so a blocked user kept
// a permanent write channel into their victim's DM view.

describe('self-targeting cannot orphan a space', () => {
  it('refuses an owner kicking themselves', async () => {
    const owner = await makeUser('selfkick')
    const serverId = await createServer(owner)

    await expect(owner.call('kick_member', [serverId, owner.idArg])).rejects.toThrow(
      /cannot kick yourself/,
    )

    // Still fully in charge afterwards.
    await expect(owner.call('rename_server', [serverId, uniqueName('ok')])).resolves.toBeUndefined()
  })

  it('refuses an owner banning themselves', async () => {
    const owner = await makeUser('selfban')
    const serverId = await createServer(owner)

    await expect(
      owner.call('ban_member', [serverId, owner.idArg, none]),
    ).rejects.toThrow(/cannot ban yourself/)
  })

  it('refuses a moderator kicking themselves', async () => {
    // Not an orphaning risk, but it is `leave_server` by another name, so the
    // gate covers every role rather than special-casing the owner.
    const owner = await makeUser('modkick_o')
    const moderator = await makeUser('modkick_m')
    const serverId = await createServer(owner)
    await makeOpenJoinable(owner, serverId)
    await moderator.call('join_discoverable_server', [serverId])
    await owner.call('set_member_role', [serverId, moderator.idArg, variant('moderator')])

    await expect(moderator.call('kick_member', [serverId, moderator.idArg])).rejects.toThrow(
      /cannot kick yourself/,
    )
  })

  it('refuses an owner transferring ownership to themselves', async () => {
    const owner = await makeUser('selfxfer')
    const serverId = await createServer(owner)

    await expect(
      owner.call('transfer_ownership', [serverId, owner.idArg]),
    ).rejects.toThrow(/you already own this space/)

    // The bug was silent: the row ended up Moderator while Server.owner_identity
    // still named the caller, so owner-gated reducers refused them forever.
    await expect(owner.call('rename_server', [serverId, uniqueName('ok')])).resolves.toBeUndefined()
  })

  it('still performs a genuine transfer', async () => {
    const owner = await makeUser('xfer_from')
    const heir = await makeUser('xfer_to')
    const serverId = await createServer(owner)
    await makeOpenJoinable(owner, serverId)
    await heir.call('join_discoverable_server', [serverId])

    await owner.call('transfer_ownership', [serverId, heir.idArg])

    await expect(heir.call('rename_server', [serverId, uniqueName('mine')])).resolves.toBeUndefined()
    await expect(owner.call('rename_server', [serverId, uniqueName('nope')])).rejects.toThrow(
      /owner permission required/,
    )
  })
})

describe('editing a DM is gated like sending one', () => {
  /** Send one DM from `from` to `to` and return its id, read back from the view. */
  async function sendDm(
    from: Awaited<ReturnType<typeof makeUser>>,
    to: Awaited<ReturnType<typeof makeUser>>,
    content: string,
  ): Promise<number> {
    await from.call('send_direct_message', [to.idArg, content])
    const { rows } = await from.sql('SELECT id, content FROM my_direct_messages')
    const row = rows.find((r) => String(r.content).includes(content))
    if (!row) throw new Error(`sent DM "${content}" not visible in my_direct_messages`)
    return Number(row.id)
  }

  it('refuses an edit after the recipient blocks the sender', async () => {
    const sender = await makeUser('dmblock_s')
    const recipient = await makeUser('dmblock_r')
    await makeFriends(sender, recipient)
    const messageId = await sendDm(sender, recipient, 'hello there')

    await recipient.call('block_user', [sender.idArg])

    await expect(
      sender.call('edit_direct_message', [messageId, 'rewritten after the block']),
    ).rejects.toThrow(/blocked relationship exists/)
  })

  it('refuses an edit after the friendship is removed', async () => {
    const sender = await makeUser('dmunfr_s')
    const recipient = await makeUser('dmunfr_r')
    await makeFriends(sender, recipient)
    const messageId = await sendDm(sender, recipient, 'still friends')

    await recipient.call('remove_friend', [sender.idArg])

    await expect(
      sender.call('edit_direct_message', [messageId, 'rewritten after unfriending']),
    ).rejects.toThrow(/friend relationship not found|friendship not accepted/)
  })

  it('still allows a friend to edit their own message', async () => {
    const sender = await makeUser('dmedit_s')
    const recipient = await makeUser('dmedit_r')
    await makeFriends(sender, recipient)
    const messageId = await sendDm(sender, recipient, 'typo here')

    await expect(
      sender.call('edit_direct_message', [messageId, 'typo fixed']),
    ).resolves.toBeUndefined()

    const { rows } = await sender.sql('SELECT id, content FROM my_direct_messages')
    const edited = rows.find((r) => Number(r.id) === messageId)
    expect(String(edited?.content)).toContain('typo fixed')
  })
})
