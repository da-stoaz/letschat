import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ServerGroup = {
  id: string
  label: string
  serverIds: number[]
  collapsed: boolean
}

// top-level rail item: number = bare serverId, string = groupId
export type RailItem = number | string

interface ServerRailState {
  order: RailItem[]
  groups: Record<string, ServerGroup>
  syncServers: (serverIds: number[]) => void
  setOrderAndGroups: (order: RailItem[], groups: Record<string, ServerGroup>) => void
  createGroup: (sourceServerId: number, targetServerId: number) => void
  addToGroup: (serverId: number, groupId: string) => void
  removeFromGroup: (serverId: number, groupId: string) => void
  toggleGroupCollapsed: (groupId: string) => void
  renameGroup: (groupId: string, label: string) => void
}

function nextGroupId(): string {
  return `g_${Date.now().toString(36)}`
}

export const useServerRailStore = create<ServerRailState>()(
  persist(
    (set) => ({
      order: [],
      groups: {},

      syncServers: (serverIds) =>
        set((state) => {
          const knownIds = new Set<number>()
          for (const item of state.order) {
            if (typeof item === 'number') {
              knownIds.add(item)
            } else {
              const g = state.groups[item]
              if (g) g.serverIds.forEach((id) => knownIds.add(id))
            }
          }

          const added = serverIds.filter((id) => !knownIds.has(id))
          const removedSet = new Set([...knownIds].filter((id) => !serverIds.includes(id)))

          if (added.length === 0 && removedSet.size === 0) return state

          const groups = { ...state.groups }
          const groupsToDissolve: string[] = []
          for (const [gid, g] of Object.entries(groups)) {
            const filtered = g.serverIds.filter((id) => !removedSet.has(id))
            if (filtered.length < 2) {
              groupsToDissolve.push(gid)
            } else {
              groups[gid] = { ...g, serverIds: filtered }
            }
          }

          let newOrder = state.order.filter((item) => {
            if (typeof item === 'number') return !removedSet.has(item)
            return !groupsToDissolve.includes(item as string)
          })

          for (const gid of groupsToDissolve) {
            const g = state.groups[gid]
            if (g) {
              const survivors = g.serverIds.filter((id) => !removedSet.has(id))
              newOrder = [...newOrder, ...survivors]
            }
            delete groups[gid]
          }

          newOrder = [...newOrder, ...added]
          return { order: newOrder, groups }
        }),

      setOrderAndGroups: (order, groups) => set({ order, groups }),

      createGroup: (sourceServerId, targetServerId) =>
        set((state) => {
          const id = nextGroupId()
          const group: ServerGroup = {
            id,
            label: 'Group',
            serverIds: [targetServerId, sourceServerId],
            collapsed: false,
          }
          const newOrder = state.order.filter((item) => item !== sourceServerId && item !== targetServerId)
          const targetIndex = state.order.findIndex((item) => item === targetServerId)
          newOrder.splice(Math.max(0, targetIndex), 0, id)
          return { order: newOrder, groups: { ...state.groups, [id]: group } }
        }),

      addToGroup: (serverId, groupId) =>
        set((state) => {
          const g = state.groups[groupId]
          if (!g || g.serverIds.includes(serverId)) return state
          return {
            order: state.order.filter((item) => item !== serverId),
            groups: { ...state.groups, [groupId]: { ...g, serverIds: [...g.serverIds, serverId] } },
          }
        }),

      removeFromGroup: (serverId, groupId) =>
        set((state) => {
          const g = state.groups[groupId]
          if (!g) return state
          const remaining = g.serverIds.filter((id) => id !== serverId)
          if (remaining.length >= 2) {
            return { groups: { ...state.groups, [groupId]: { ...g, serverIds: remaining } } }
          }
          // Dissolve: put survivors back in order where group was
          const idx = state.order.indexOf(groupId)
          const before = state.order.slice(0, idx < 0 ? state.order.length : idx)
          const after = state.order.slice(idx < 0 ? state.order.length : idx + 1)
          const groups = { ...state.groups }
          delete groups[groupId]
          return { order: [...before, ...remaining, ...after], groups }
        }),

      toggleGroupCollapsed: (groupId) =>
        set((state) => {
          const g = state.groups[groupId]
          if (!g) return state
          return { groups: { ...state.groups, [groupId]: { ...g, collapsed: !g.collapsed } } }
        }),

      renameGroup: (groupId, label) =>
        set((state) => {
          const g = state.groups[groupId]
          if (!g || g.label === label) return state
          return { groups: { ...state.groups, [groupId]: { ...g, label } } }
        }),
    }),
    {
      name: 'letschat.server-rail',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ order: state.order, groups: state.groups }),
    },
  ),
)