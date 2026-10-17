import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import type { DbConnection as Connection } from '../../src/generated'
import type { Identity } from 'spacetimedb'

// The candidate harness runs against each release's own SDK and generated bindings.
const source = resolve(process.env.COMPAT_CLIENT_SOURCE ?? '.')
const { DbConnection, tables }: typeof import('../../src/generated') = await import(`${source}/src/generated/index.ts`)
const { evaluateCompatibility }: typeof import('../../src/lib/clientCompatibility') = await import(`${source}/src/lib/clientCompatibility.ts`)
const auth = process.env.COMPAT_AUTH_URL!
const database = process.env.COMPAT_DATABASE_URL!
assert(new URL(auth).hostname === '127.0.0.1', 'Only disposable loopback services are allowed')
assert(new URL(database).hostname === '127.0.0.1')
const password = process.env.COMPAT_PASSWORD!
const sockets: Connection[] = []
const deadline = setTimeout(() => { console.error('Compatibility smoke timed out'); process.exit(1) }, 90_000)

async function post(path: string, body: object) {
  const response = await fetch(`${auth}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(response.status, 200, `${path}: ${response.status}`)
  return response.json()
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await new Promise(done => setTimeout(done, 100))
  }
  assert(check(), 'Subscription did not receive the expected row')
}
async function connect(token: string): Promise<{ conn: Connection; identity: Identity }> {
  return new Promise((resolveConnection, reject) => {
    const conn = DbConnection.builder().withUri(database.replace(/^http/, 'ws')).withDatabaseName('letschat')
      .withCompression('none').withLightMode(false).withToken(token)
      .onConnect((connection, identity) => resolveConnection({ conn: connection, identity }))
      .onConnectError((_context, error) => reject(error)).build()
    sockets.push(conn)
  })
}
async function subscribe(conn: Connection) {
  const implementation = readFileSync(`${source}/src/lib/spacetimedb/connection.ts`, 'utf8')
  const block = implementation.match(/\.subscribe\(\[([\s\S]*?)\]\)/)?.[1]
  assert(block, 'Locate the release client’s actual subscription list')
  const subscriptions = [...block.matchAll(/tables\.(\w+)/g)].map(match => tables[match[1] as keyof typeof tables])
  assert(subscriptions.length > 0 && subscriptions.every(Boolean))
  await new Promise<void>((done, reject) => conn.subscriptionBuilder().onApplied(() => done())
    .onError((_context, error) => reject(error)).subscribe(subscriptions))
}

try {
  const discovery = await (await fetch(`${auth}/.well-known/letschat.json`)).json()
  assert.equal(evaluateCompatibility(discovery).status, 'compatible', 'Release declares incompatible client/backend')
  const accountA = await post('/auth/login', { username: 'admin', password })
  await post('/auth/register', { username: 'compatbob', displayName: 'Bob', email: 'bob@test.local', password })
  const accountB = await post('/auth/login', { username: 'compatbob', password })
  const a = await connect(accountA.spacetimeToken)
  const b = await connect(accountB.spacetimeToken)
  await subscribe(a.conn)
  await subscribe(b.conn)
  if (![...a.conn.db.my_visible_users.iter()].some(row => row.identity.isEqual(a.identity))) {
    await a.conn.reducers.registerUser({ username: 'admin', displayName: 'Admin' })
  }
  if (![...b.conn.db.my_visible_users.iter()].some(row => row.identity.isEqual(b.identity))) {
    await b.conn.reducers.registerUser({ username: 'compatbob', displayName: 'Bob' })
  }
  await a.conn.reducers.createServer({ name: 'Compatibility smoke' })
  await until(() => [...a.conn.db.my_channels.iter()].some(row => row.kind.tag === 'Text'))
  const text = [...a.conn.db.my_channels.iter()].find(row => row.kind.tag === 'Text')!
  const voice = [...a.conn.db.my_channels.iter()].find(row => row.kind.tag === 'Voice')!
  assert(voice)
  await a.conn.reducers.sendMessage({ channelId: text.id, content: 'compatibility channel message' })
  await until(() => [...a.conn.db.my_channel_messages.iter()].some(row => row.content === 'compatibility channel message'))
  await a.conn.reducers.sendFriendRequest({ targetIdentity: b.identity })
  await until(() => [...b.conn.db.my_friends.iter()].length > 0)
  await b.conn.reducers.acceptFriendRequest({ requesterIdentity: a.identity })
  await a.conn.reducers.sendDirectMessage({ recipientIdentity: b.identity, content: 'compatibility DM' })
  await until(() => [...b.conn.db.my_direct_messages.iter()].some(row => row.content === 'compatibility DM'))
  await a.conn.reducers.joinVoiceChannel({ channelId: voice.id })
  await until(() => [...a.conn.db.my_voice_participants.iter()].some(row => row.channelId === voice.id))
  const voiceToken = await post('/livekit/token', { room: String(voice.id), identity: accountA.spacetimeIdentity, sessionToken: accountA.sessionToken })
  assert.equal(voiceToken.token.split('.').length, 3)
  console.log('PASS discovery, real sign-in, generated subscriptions, channel message, DM, voice token')
} finally {
  for (const socket of sockets) socket.disconnect()
  clearTimeout(deadline)
}
