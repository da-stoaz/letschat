import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Server, u64 } from '../types/domain'

interface ServersState {
  servers: Server[]
  activeServerId: u64 | null
  setServers: (servers: Server[]) => void
  setActiveServerId: (id: u64 | null) => void
}

export const useServersStore = create<ServersState>()(
  persist(
    (set) => ({
      servers: [],
      activeServerId: null,
      setServers: (servers) =>
        set((state) => {
          const activeServerStillExists =
            state.activeServerId !== null && servers.some((server) => server.id === state.activeServerId)
          return {
            servers,
            activeServerId: activeServerStillExists ? state.activeServerId : null,
          }
        }),
      setActiveServerId: (id) => set((state) => (state.activeServerId === id ? state : { activeServerId: id })),
    }),
    {
      name: 'letschat.servers.ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeServerId: state.activeServerId,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<ServersState>),
        servers: currentState.servers,
      }),
    },
  ),
)
