import { describe, expect, it } from 'vitest'
import { inviteToken } from './useDeepLink'

describe('inviteToken', () => {
  const base = 'letschat://join?s=https%3A%2F%2Fchat.x&a=https%3A%2F%2Fauth.x&l=https%3A%2F%2Flk.x&d=letschat'
  it('reads the invite token core-api appends', () => expect(inviteToken(`${base}&i=Abc123`)).toBe('Abc123'))
  it('ignores a plain join link', () => expect(inviteToken(base)).toBeNull())
  it('rejects anything that could change the route', () => expect(inviteToken(`${base}&i=..%2Fapp`)).toBeNull())
})
