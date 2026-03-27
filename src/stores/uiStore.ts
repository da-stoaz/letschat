import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Identity, u64 } from '../types/domain'

function normalizeIdentityKey(identity: Identity): Identity {
  return identity.trim().toLowerCase() as Identity
}

interface UiState {
  activeChannelId: u64 | null
  activeDmPartner: Identity | null
  rightPanelOpen: boolean
  activeCallDockVisible: boolean
  modals: Record<string, boolean>
  unreadByChannel: Record<u64, number>
  unreadByDmPartner: Record<Identity, number>
  mutedChannels: Record<u64, boolean>
  mutedServers: Record<u64, boolean>
  mutedUsers: Record<Identity, boolean>
  setActiveChannelId: (channelId: u64 | null) => void
  setActiveDmPartner: (identity: Identity | null) => void
  toggleRightPanel: () => void
  setActiveCallDockVisible: (visible: boolean) => void
  setModal: (name: string, open: boolean) => void
  incrementUnread: (channelId: u64) => void
  clearUnread: (channelId: u64) => void
  incrementDmUnread: (identity: Identity) => void
  clearDmUnread: (identity: Identity) => void
  toggleMutedChannel: (channelId: u64) => void
  toggleMutedServer: (serverId: u64) => void
  toggleMutedUser: (identity: Identity) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeChannelId: null,
      activeDmPartner: null,
      rightPanelOpen: false,
      activeCallDockVisible: false,
      modals: {},
      unreadByChannel: {},
      unreadByDmPartner: {},
      mutedChannels: {},
      mutedServers: {},
      mutedUsers: {},
      setActiveChannelId: (channelId) =>
        set((state) => (state.activeChannelId === channelId ? state : { activeChannelId: channelId })),
      setActiveDmPartner: (identity) =>
        set((state) => (state.activeDmPartner === identity ? state : { activeDmPartner: identity })),
      toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
      setActiveCallDockVisible: (visible) =>
        set((state) => (state.activeCallDockVisible === visible ? state : { activeCallDockVisible: visible })),
      setModal: (name, open) =>
        set((state) => {
          if (state.modals[name] === open) return state
          return {
            modals: { ...state.modals, [name]: open },
          }
        }),
      incrementUnread: (channelId) =>
        set((state) => ({
          unreadByChannel: {
            ...state.unreadByChannel,
            [channelId]: (state.unreadByChannel[channelId] ?? 0) + 1,
          },
        })),
      clearUnread: (channelId) =>
        set((state) => {
          if ((state.unreadByChannel[channelId] ?? 0) === 0) return state
          return {
            unreadByChannel: {
              ...state.unreadByChannel,
              [channelId]: 0,
            },
          }
        }),
      incrementDmUnread: (identity) =>
        set((state) => {
          const key = normalizeIdentityKey(identity)
          return {
            unreadByDmPartner: {
              ...state.unreadByDmPartner,
              [key]: (state.unreadByDmPartner[key] ?? 0) + 1,
            },
          }
        }),
      clearDmUnread: (identity) =>
        set((state) => {
          const key = normalizeIdentityKey(identity)
          if ((state.unreadByDmPartner[key] ?? 0) === 0) return state
          return {
            unreadByDmPartner: {
              ...state.unreadByDmPartner,
              [key]: 0,
            },
          }
        }),
      toggleMutedChannel: (channelId) =>
        set((state) => ({
          mutedChannels: {
            ...state.mutedChannels,
            [channelId]: !(state.mutedChannels[channelId] ?? false),
          },
        })),
      toggleMutedServer: (serverId) =>
        set((state) => ({
          mutedServers: {
            ...state.mutedServers,
            [serverId]: !(state.mutedServers[serverId] ?? false),
          },
        })),
      toggleMutedUser: (identity) =>
        set((state) => {
          const key = normalizeIdentityKey(identity)
          return {
            mutedUsers: {
              ...state.mutedUsers,
              [key]: !(state.mutedUsers[key] ?? false),
            },
          }
        }),
    }),
    {
      name: 'letschat.ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeChannelId: state.activeChannelId,
        activeDmPartner: state.activeDmPartner,
        rightPanelOpen: state.rightPanelOpen,
        unreadByChannel: state.unreadByChannel,
        unreadByDmPartner: state.unreadByDmPartner,
        mutedChannels: state.mutedChannels,
        mutedServers: state.mutedServers,
        mutedUsers: state.mutedUsers,
      }),
    },
  ),
)
