import { create } from 'zustand'
import type { DmServerInvite, Identity } from '../types/domain'

interface DmServerInvitesState {
  // All pending/resolved DM invites involving the current user (sent or received)
  invites: DmServerInvite[]
  setInvites: (invites: DmServerInvite[]) => void
  addInvite: (invite: DmServerInvite) => void
  updateInvite: (invite: DmServerInvite) => void
  removeInvite: (id: number) => void
  pendingReceivedInvites: (selfIdentity: Identity) => DmServerInvite[]
}

export const useDmServerInvitesStore = create<DmServerInvitesState>((set, get) => ({
  invites: [],
  setInvites: (invites) => set({ invites }),
  addInvite: (invite) =>
    set((state) => ({
      invites: [...state.invites.filter((i) => i.id !== invite.id), invite],
    })),
  updateInvite: (invite) =>
    set((state) => ({
      invites: state.invites.map((i) => (i.id === invite.id ? invite : i)),
    })),
  removeInvite: (id) =>
    set((state) => ({ invites: state.invites.filter((i) => i.id !== id) })),
  pendingReceivedInvites: (selfIdentity) =>
    get().invites.filter(
      (i) => i.recipientIdentity === selfIdentity && i.status === 'Pending',
    ),
}))
