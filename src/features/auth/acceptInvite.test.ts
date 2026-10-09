import { expect, it, vi } from 'vitest'
import { callProcedure } from '../../lib/spacetimedb/connection'
import { reducers } from '../../lib/spacetimedb'
import { acceptInvite } from './acceptInvite'

vi.mock('../../lib/spacetimedb/connection', () => ({ callProcedure: vi.fn() }))
vi.mock('../../lib/spacetimedb', () => ({ reducers: { useInvite: vi.fn() } }))

it('captures the exact destination before consuming the token and never joins an unresolved invite', async () => {
  vi.mocked(callProcedure).mockResolvedValueOnce(42n).mockResolvedValueOnce(undefined)
  vi.mocked(reducers.useInvite).mockImplementation(async () => {
    expect(callProcedure).toHaveBeenCalledWith('resolveInviteServer', { token: 'single-use' })
  })
  expect(await acceptInvite('single-use')).toBe(42)
  await expect(acceptInvite('unknown')).rejects.toThrow('unavailable')
  expect(reducers.useInvite).toHaveBeenCalledTimes(1)
})
