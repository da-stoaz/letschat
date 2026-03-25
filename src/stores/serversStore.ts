import { create } from 'zustand'
import type { Server, u64 } from '../types/domain'

interface ServersState {
  servers: Server[]
  activeServerId: u64 | null
  setServers: (servers: Server[]) => void
  setActiveServerId: (id: u64 | null) => void
}

export const useServersStore = create<ServersState>((set) => ({
  servers: [],
  activeServerId: null,
  setServers: (servers) => set({ servers }),
  setActiveServerId: (id) => set({ activeServerId: id }),
}))
