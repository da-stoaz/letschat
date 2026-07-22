// Seeds a rich fixture across ALL durable tables, for the A2 whole-DB rebuild
// test. Every optional step is best-effort (wrapped) so a rule change that
// blocks one path still populates the rest — the parity test then compares
// whatever actually landed. Run with STDB_TEST_DB=rebuildtest.

import { makeUser, createServer, createChannel, makeFriends, variant, some, none } from '../security/harness'

const log = (s: string) => console.log(`[fixture] ${s}`)
async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); log(`ok: ${name}`) } catch (e) { log(`SKIP ${name}: ${e instanceof Error ? e.message.slice(0, 80) : e}`) }
}

const a = await makeUser('owner')
const b = await makeUser('memberb')
const c = await makeUser('targetc')

// server + owner membership + channel + messages
const server = await createServer(a)
await tryStep('set discovery + description', () => a.call('set_server_discovery', [server, true, some('a cool test space')]))
await tryStep('set invite policy everyone', () => a.call('set_server_invite_policy', [server, variant('everyone')]))
await tryStep('set tags (text[])', () => a.call('set_server_tags', [server, ['games', 'chat']]))
const channel = await createChannel(a, server)
for (let i = 0; i < 4; i++) await a.call('send_message', [channel, `fixture-msg-${i}`])

// pin a message → pinned_message table
await tryStep('pin a message', async () => {
  const { rows } = await a.sql(`SELECT id FROM my_channel_messages WHERE channel_id = ${channel} LIMIT 1`)
  await a.call('pin_message', [channel, Number(rows[0].id)])
})

// invites — two rows to cover both map shapes: max_uses(Some)/empty whitelist,
// and max_uses(None)/non-empty whitelist (the two can't be combined).
await tryStep('invite: max_uses', () => a.call('create_invite', [server, some(3600), some(5), []]))
await tryStep('invite: whitelist', () => a.call('create_invite', [server, some(7200), none, [b.username]]))

// members join → server_member (Role Member); read_state
await tryStep('b joins', () => b.call('join_discoverable_server', [server]))
await tryStep('c joins', () => c.call('join_discoverable_server', [server]))
await tryStep('mark read', () => a.call('mark_channel_read', [channel]))

// friends (Accepted A-B, Pending A-C); DM; block; dm-server-invite
await tryStep('friends A-B (Accepted)', () => makeFriends(a, b))
await tryStep('friend req A-C (Pending)', () => a.call('send_friend_request', [c.idArg]))
await tryStep('direct message A→B', () => a.call('send_direct_message', [b.idArg, 'fixture dm hello']))
await tryStep('block A→C', () => a.call('block_user', [c.idArg]))
// dm-server-invite needs a non-member recipient → a fresh friend D
const d = await makeUser('inviteed')
await tryStep('friends A-D', () => makeFriends(a, d))
await tryStep('dm server invite A→D', () => a.call('send_dm_server_invite', [d.idArg, server]))

// ban C (must be a member) → ban row + removes membership
await tryStep('ban C', () => a.call('ban_member', [server, c.idArg, some('testing bans')]))

// second server: discoverable + default policy → join request from B
await tryStep('server2 + join request', async () => {
  const server2 = await createServer(a)
  await a.call('set_server_discovery', [server2, true, none])
  await b.call('request_to_join', [server2])
})

log(`done. owner=${a.identity.slice(0, 12)} server=${server} channel=${channel}`)
