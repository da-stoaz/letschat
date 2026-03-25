import { create } from 'zustand'
import type { ServerMember, Identity, User, u64 } from '../types/domain'

export interface ServerMemberWithUser extends ServerMember {
  user: User | null
}

interface MembersState {
  membersByServer: Record<u64, ServerMemberWithUser[]>
  setServerMembers: (serverId: u64, members: ServerMemberWithUser[]) => void
  findRole: (serverId: u64, identity: Identity) => ServerMember['role'] | null
}

export const useMembersStore = create<MembersState>((set, get) => ({
  membersByServer: {},
  setServerMembers: (serverId, members) =>
    set((state) => ({
      membersByServer: { ...state.membersByServer, [serverId]: members },
    })),
  findRole: (serverId, identity) => {
    const row = (get().membersByServer[serverId] ?? []).find((m) => m.userIdentity === identity)
    return row?.role ?? null
  },
}))
