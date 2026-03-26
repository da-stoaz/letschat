import { create } from 'zustand'
import type { Identity, User } from '../types/domain'

interface UsersState {
  users: User[]
  byIdentity: Record<Identity, User>
  setUsers: (users: User[]) => void
  getByIdentity: (identity: Identity) => User | null
}

export const useUsersStore = create<UsersState>((set, get) => ({
  users: [],
  byIdentity: {},
  setUsers: (users) => {
    const byIdentity: Record<Identity, User> = {}
    for (const user of users) {
      byIdentity[user.identity] = user
    }
    set({ users, byIdentity })
  },
  getByIdentity: (identity) => get().byIdentity[identity] ?? null,
}))
