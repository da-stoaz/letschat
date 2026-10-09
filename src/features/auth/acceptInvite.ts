import { reducers } from '../../lib/spacetimedb'
import { callProcedure } from '../../lib/spacetimedb/connection'
import { toU64Number } from '../../lib/spacetimedb/mappers'

export async function acceptInvite(token: string): Promise<number> {
  const serverId = await callProcedure<bigint | undefined>('resolveInviteServer', { token })
  if (serverId === undefined) throw new Error('This invite is unavailable or is not addressed to your account.')
  const id = toU64Number(serverId)
  await reducers.useInvite(token)
  return id
}
