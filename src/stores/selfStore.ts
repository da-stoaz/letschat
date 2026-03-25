import { create } from 'zustand'
import type { User } from '../types/domain'

interface SelfState {
  user: User | null
  setUser: (user: User | null) => void
}

export const useSelfStore = create<SelfState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}))
