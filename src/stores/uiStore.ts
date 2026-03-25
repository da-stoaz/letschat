import { create } from 'zustand'
import type { Identity, u64 } from '../types/domain'

interface UiState {
  activeChannelId: u64 | null
  activeDmPartner: Identity | null
  rightPanelOpen: boolean
  modals: Record<string, boolean>
  unreadByChannel: Record<u64, number>
  setActiveChannelId: (channelId: u64 | null) => void
  setActiveDmPartner: (identity: Identity | null) => void
  toggleRightPanel: () => void
  setModal: (name: string, open: boolean) => void
  incrementUnread: (channelId: u64) => void
  clearUnread: (channelId: u64) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeChannelId: null,
  activeDmPartner: null,
  rightPanelOpen: false,
  modals: {},
  unreadByChannel: {},
  setActiveChannelId: (channelId) => set({ activeChannelId: channelId }),
  setActiveDmPartner: (identity) => set({ activeDmPartner: identity }),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  setModal: (name, open) =>
    set((state) => ({
      modals: { ...state.modals, [name]: open },
    })),
  incrementUnread: (channelId) =>
    set((state) => ({
      unreadByChannel: {
        ...state.unreadByChannel,
        [channelId]: (state.unreadByChannel[channelId] ?? 0) + 1,
      },
    })),
  clearUnread: (channelId) =>
    set((state) => ({
      unreadByChannel: {
        ...state.unreadByChannel,
        [channelId]: 0,
      },
    })),
}))
