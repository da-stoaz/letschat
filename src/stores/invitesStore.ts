import { create } from 'zustand'
import type { Invite, u64 } from '../types/domain'

interface InvitesState {
  invitesByServer: Record<u64, Invite[]>
  setServerInvites: (serverId: u64, invites: Invite[]) => void
  addInvite: (invite: Invite) => void
  removeInvite: (token: string) => void
  updateInvite: (invite: Invite) => void
}

export const useInvitesStore = create<InvitesState>((set) => ({
  invitesByServer: {},
  setServerInvites: (serverId, invites) =>
    set((state) => ({
      invitesByServer: { ...state.invitesByServer, [serverId]: invites },
    })),
  addInvite: (invite) =>
    set((state) => {
      const existing = state.invitesByServer[invite.serverId] ?? []
      return {
        invitesByServer: {
          ...state.invitesByServer,
          [invite.serverId]: [...existing.filter((i) => i.token !== invite.token), invite],
        },
      }
    }),
  removeInvite: (token) =>
    set((state) => {
      const next: typeof state.invitesByServer = {}
      for (const [sid, invites] of Object.entries(state.invitesByServer)) {
        next[Number(sid)] = invites.filter((i) => i.token !== token)
      }
      return { invitesByServer: next }
    }),
  updateInvite: (invite) =>
    set((state) => {
      const existing = state.invitesByServer[invite.serverId] ?? []
      return {
        invitesByServer: {
          ...state.invitesByServer,
          [invite.serverId]: existing.map((i) => (i.token === invite.token ? invite : i)),
        },
      }
    }),
}))
