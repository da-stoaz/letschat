import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Identity, u64 } from '../types/domain'

function normalizeIdentityKey(identity: Identity): Identity {
  return identity.trim().toLowerCase() as Identity
}

export type NotificationPreferenceEvent =
  | 'channelMessages'
  | 'directMessages'
  | 'friendRequests'
  | 'friendAccepted'
  | 'incomingCalls'
  | 'missedCalls'
  | 'mentions'

export type NotificationSettings = {
  enabled: boolean
  eventToggles: Record<NotificationPreferenceEvent, boolean>
  showPreviews: boolean
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  eventToggles: {
    channelMessages: true,
    directMessages: true,
    friendRequests: true,
    friendAccepted: true,
    incomingCalls: true,
    missedCalls: true,
    mentions: true,
  },
  showPreviews: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
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
  notificationSettings: NotificationSettings
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
  setNotificationsEnabled: (enabled: boolean) => void
  setNotificationEventEnabled: (event: NotificationPreferenceEvent, enabled: boolean) => void
  setNotificationPreviewsEnabled: (enabled: boolean) => void
  setNotificationQuietHoursEnabled: (enabled: boolean) => void
  setNotificationQuietHoursRange: (start: string, end: string) => void
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
      notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
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
      setNotificationsEnabled: (enabled) =>
        set((state) =>
          state.notificationSettings.enabled === enabled ?
            state
          : {
              notificationSettings: {
                ...state.notificationSettings,
                enabled,
              },
            },
        ),
      setNotificationEventEnabled: (event, enabled) =>
        set((state) =>
          state.notificationSettings.eventToggles[event] === enabled ?
            state
          : {
              notificationSettings: {
                ...state.notificationSettings,
                eventToggles: {
                  ...state.notificationSettings.eventToggles,
                  [event]: enabled,
                },
              },
            },
        ),
      setNotificationPreviewsEnabled: (enabled) =>
        set((state) =>
          state.notificationSettings.showPreviews === enabled ?
            state
          : {
              notificationSettings: {
                ...state.notificationSettings,
                showPreviews: enabled,
              },
            },
        ),
      setNotificationQuietHoursEnabled: (enabled) =>
        set((state) =>
          state.notificationSettings.quietHoursEnabled === enabled ?
            state
          : {
              notificationSettings: {
                ...state.notificationSettings,
                quietHoursEnabled: enabled,
              },
            },
        ),
      setNotificationQuietHoursRange: (start, end) =>
        set((state) => {
          const normalizedStart = start.trim() || DEFAULT_NOTIFICATION_SETTINGS.quietHoursStart
          const normalizedEnd = end.trim() || DEFAULT_NOTIFICATION_SETTINGS.quietHoursEnd
          if (
            state.notificationSettings.quietHoursStart === normalizedStart &&
            state.notificationSettings.quietHoursEnd === normalizedEnd
          ) {
            return state
          }
          return {
            notificationSettings: {
              ...state.notificationSettings,
              quietHoursStart: normalizedStart,
              quietHoursEnd: normalizedEnd,
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
        notificationSettings: state.notificationSettings,
      }),
    },
  ),
)
