import { useMemo } from 'react'
import { useConnectionStore } from '../stores/connectionStore'
import { useMembersStore } from '../stores/membersStore'
import type { Role, u64 } from '../types/domain'

export function useServerRole(serverId: u64 | null): Role | null {
  const identity = useConnectionStore((s) => s.identity)
  const findRole = useMembersStore((s) => s.findRole)

  return useMemo(() => {
    if (!identity || serverId === null) return null
    return findRole(serverId, identity)
  }, [findRole, identity, serverId])
}
