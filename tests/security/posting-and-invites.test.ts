import { describe, it, expect } from 'vitest'
import { createServer, makeOpenJoinable, makeUser, none, variant, type TestUser } from './harness'

// Write paths that checked less than their neighbours (BUG_ANALYSIS B4, B13)
// and invites that outlived the rules meant to govern them (A13, B12). Every
// case below was reproduced against the unpatched module first.

async function channelsOf(user: TestUser) {
  const { rows } = await user.sql('SELECT id, name FROM my_channels')
  return {
    text: Number(rows.find((c) => c.name === 'general')!.id),
    voice: Number(rows.find((c) => c.name === 'General')!.id),
  }
}

async function messageId(owner: TestUser, content: string): Promise<number> {
  const { rows } = await owner.sql('SELECT id, content FROM my_channel_messages')
  return Number(rows.find((m) => m.content === content)!.id)
}

async function spaceWithMember(prefix: string) {
  const owner = await makeUser(`${prefix}_o`)
  const member = await makeUser(`${prefix}_m`)
  const serverId = await createServer(owner)
  await makeOpenJoinable(owner, serverId)
  await member.call('join_discoverable_server', [serverId])
  return { owner, member, serverId, ...(await channelsOf(member)) }
}

describe('editing obeys the same rules as sending (B4)', () => {
  it('refuses to edit a message a moderator deleted', async () => {
    const { owner, member, text } = await spaceWithMember('edel')
    await member.call('send_message', [text, 'original'])
    const id = await messageId(owner, 'original')
    await owner.call('delete_message', [id])

    await expect(member.call('edit_message', [id, 'resurrected'])).rejects.toThrow(/message was deleted/)
  })

  it('refuses edits after a kick and during a timeout', async () => {
    const { owner, member, serverId, text } = await spaceWithMember('ekick')
    await member.call('send_message', [text, 'before timeout'])
    const id = await messageId(owner, 'before timeout')

    await owner.call('timeout_member', [serverId, member.idArg, 600])
    await expect(member.call('edit_message', [id, 'during timeout'])).rejects.toThrow(/timed out/)

    await owner.call('kick_member', [serverId, member.idArg])
    await expect(member.call('edit_message', [id, 'after kick'])).rejects.toThrow(/not a server member/)
  })

  it('still lets a member edit their own message', async () => {
    const { owner, member, text } = await spaceWithMember('eok')
    await member.call('send_message', [text, 'typo'])
    await expect(member.call('edit_message', [await messageId(owner, 'typo'), 'fixed'])).resolves.toBeUndefined()
  })
})

describe('channel kind and timeouts (B13)', () => {
  it('refuses text messages in a voice channel', async () => {
    const { member, voice } = await spaceWithMember('vtext')
    await expect(member.call('send_message', [voice, 'into voice'])).rejects.toThrow(/not a text channel/)
  })

  it('refuses a timed-out member joining voice', async () => {
    const { owner, member, serverId, voice } = await spaceWithMember('vtime')
    await owner.call('timeout_member', [serverId, member.idArg, 600])
    await expect(member.call('join_voice_channel', [voice])).rejects.toThrow(/timed out/)
  })
})

describe('invites (A13, B12)', () => {
  it('shows plain members only their own invites', async () => {
    const { owner, member, serverId } = await spaceWithMember('inview')
    await owner.call('create_invite', [serverId, none, none, []])
    await member.call('create_invite', [serverId, none, none, []])

    expect((await member.sql('SELECT token FROM my_invites')).rows).toHaveLength(1)
    expect((await owner.sql('SELECT token FROM my_invites')).rows).toHaveLength(2)
  })

  it('kills a member invite once the space switches to ModeratorsOnly', async () => {
    const { owner, member, serverId } = await spaceWithMember('inpol')
    const outsider = await makeUser('inpol_x')
    await member.call('create_invite', [serverId, none, none, []])
    const token = (await member.sql('SELECT token FROM my_invites')).rows[0].token
    await owner.call('set_server_invite_policy', [serverId, variant('moderatorsOnly')])

    await expect(outsider.call('use_invite', [token])).rejects.toThrow(/no longer valid/)
  })

  it('binds a DM invite to its recipient', async () => {
    const owner = await makeUser('indm_o')
    const invitee = await makeUser('indm_i')
    const outsider = await makeUser('indm_x')
    const serverId = await createServer(owner)
    await owner.call('send_dm_server_invite', [invitee.idArg, serverId])
    const token = (await owner.sql('SELECT token FROM my_invites')).rows[0].token

    await expect(outsider.call('use_invite', [token])).rejects.toThrow(/whitelist/)
    await expect(invitee.call('use_invite', [token])).resolves.toBeUndefined()
  })

  it('refuses a DM invite across a block', async () => {
    const victim = await makeUser('inblk_v')
    const harasser = await makeUser('inblk_h')
    const serverId = await createServer(harasser)
    await victim.call('block_user', [harasser.idArg])

    await expect(harasser.call('send_dm_server_invite', [victim.idArg, serverId])).rejects.toThrow(
      /blocked relationship/,
    )
  })
})
