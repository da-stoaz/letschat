// Run only via tests/compatibility/run.py --check-revocation: disposable real
// PostgreSQL + Core API + public chat edge + SpacetimeDB, using the shipped SDK.
import assert from 'node:assert/strict'
import { DbConnection } from '../../src/generated'

const auth = process.env.COMPAT_AUTH_URL!
const database = process.env.COMPAT_DATABASE_URL!
assert.equal(new URL(auth).hostname, '127.0.0.1')
assert.equal(new URL(database).hostname, '127.0.0.1')
const sockets: DbConnection[] = []
const deadline = setTimeout(() => { console.error('Revocation smoke timed out'); process.exit(1) }, 60_000)
async function post(path: string, body: object) {
  return fetch(`${auth}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
async function login(password: string) {
  const response = await post('/auth/login', { username: 'compatbob', password })
  assert.equal(response.status, 200)
  return response.json()
}
async function connect(token: string, disconnected = () => {}): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder().withUri(database).withDatabaseName('letschat')
      .withToken(token).withCompression('gzip').withLightMode(false)
      .onConnect(connection => resolve(connection))
      .onConnectError((_context, error) => reject(error))
      .onDisconnect(disconnected).build()
    sockets.push(conn)
  })
}
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert(check(), 'Expected socket/subscription state was not reached')
}

try {
  const original = await login(process.env.COMPAT_PASSWORD!)
  let disconnected = false
  const old = await connect(original.spacetimeToken, () => { disconnected = true })
  await new Promise<void>((resolve, reject) => old.subscriptionBuilder().onApplied(() => resolve())
    .onError((_context, error) => reject(error)).subscribe(['SELECT * FROM my_direct_messages']))
  assert([...old.db.my_direct_messages.iter()].some(row => row.content === 'compatibility DM'))

  const ticketResponse = await fetch(`${database}/v1/identity/websocket-token`, {
    method: 'POST', headers: { Authorization: `Bearer ${original.spacetimeToken}` },
  })
  assert.equal(ticketResponse.status, 200)
  const ticket = (await ticketResponse.json()).token
  const password = 'revocation-smoke-replacement-123'
  assert.equal((await post('/auth/change-password', {
    sessionToken: original.sessionToken, currentPassword: process.env.COMPAT_PASSWORD, newPassword: password,
  })).status, 204)
  await until(() => disconnected)
  assert.equal(old.isActive, false)
  assert.equal((await fetch(`${database}/v1/identity/websocket-token`, {
    method: 'POST', headers: { Authorization: `Bearer ${original.spacetimeToken}` },
  })).status, 401)
  // A ticket exchanged before revocation is revalidated when used, even if the
  // caller skips the SDK's normal fresh exchange before reconnecting.
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${database.replace(/^http/, 'ws')}/v1/database/letschat/subscribe?token=${ticket}`, ['v1.bsatn.spacetimedb'])
    socket.onopen = () => { socket.close(); reject(new Error('Revoked ticket admitted')) }
    socket.onerror = () => resolve()
  })
  for (const path of ['/v1/database/letschat/sql', '/v1/database/letschat/call/touch_presence']) {
    assert.equal((await fetch(database + path, { method: 'POST', headers: { Authorization: `Bearer ${original.spacetimeToken}` }, body: '[]' })).status, 404)
  }
  const fresh = await login(password)
  const current = await connect(fresh.spacetimeToken)
  await new Promise<void>((resolve, reject) => current.subscriptionBuilder().onApplied(() => resolve())
    .onError((_context, error) => reject(error)).subscribe(['SELECT * FROM my_direct_messages']))
  assert([...current.db.my_direct_messages.iter()].some(row => row.content === 'compatibility DM'))
  await current.reducers.touchPresence({})
  console.log('PASS real compressed subscriptions, password revocation, active socket closure, stale ticket rejection, private raw API, fresh-token recovery')
} finally {
  for (const socket of sockets) socket.disconnect()
  clearTimeout(deadline)
}
