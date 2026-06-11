import { describe, it, expect, beforeAll } from 'vitest'
import { makeUser, type TestUser } from './harness'

// `user` is private, so the client can no longer resolve a username → identity
// itself. `send_friend_request_by_username` does that lookup server-side; these
// tests pin its behaviour (success + the two error paths).

describe('send_friend_request_by_username', () => {
  let alice: TestUser
  let bob: TestUser

  beforeAll(async () => {
    alice = await makeUser('alice')
    bob = await makeUser('bob')
  })

  it('resolves the username server-side and creates a pending friend request', async () => {
    await alice.call('send_friend_request_by_username', [bob.username])

    const aliceFriends = await alice.sql('SELECT status FROM my_friends')
    const bobFriends = await bob.sql('SELECT status FROM my_friends')

    // Both ends now have the (single) pending relationship.
    expect(aliceFriends.rows).toHaveLength(1)
    expect(bobFriends.rows).toHaveLength(1)
    // FriendStatus is a sum type; /sql results encode it positionally as
    // [variantIndex, payload]. Pending is variant 0 → not yet accepted.
    expect(aliceFriends.rows[0].status).toEqual([0, []])
  })

  it('errors clearly for an unknown username', async () => {
    await expect(
      alice.call('send_friend_request_by_username', ['definitely_not_a_real_user']),
    ).rejects.toThrow(/no user found/i)
  })

  it('refuses to friend yourself', async () => {
    await expect(
      alice.call('send_friend_request_by_username', [alice.username]),
    ).rejects.toThrow(/yourself/i)
  })
})
