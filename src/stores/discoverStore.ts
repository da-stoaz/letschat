import { create } from 'zustand'
import type { DiscoverServer } from '../types/domain'

interface DiscoverState {
  /** Public, discoverable spaces the caller is not already a member of. */
  servers: DiscoverServer[]
  setServers: (servers: DiscoverServer[]) => void
}

export const useDiscoverStore = create<DiscoverState>((set) => ({
  servers: [],
  setServers: (servers) => set({ servers }),
}))
