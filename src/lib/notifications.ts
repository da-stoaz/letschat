import { tauriCommands, type NotificationPermissionState } from './tauri'
import { useUiStore } from '../stores/uiStore'
import type { Identity } from '../types/domain'

type NotificationPriority = 'normal' | 'silent'

type NotificationMatrixEntry = {
  preferenceKey:
    | 'channelMessages'
    | 'directMessages'
    | 'friendRequests'
    | 'friendAccepted'
    | 'incomingCalls'
    | 'missedCalls'
    | 'mentions'
    | null
  priority: NotificationPriority
  suppression: string[]
}

export type NotificationEventType =
  | 'channel_message'
  | 'mention'
  | 'direct_message'
  | 'friend_request'
  | 'friend_accepted'
  | 'incoming_call'
  | 'missed_call'
  | 'call_ended'
  | 'system'

type BasePayload = {
  dedupeKey?: string
  suppress?: boolean
  suppressIfFocusedAndActive?: boolean
}

type ChannelMessagePayload = BasePayload & {
  senderLabel: string
  content: string
  channelName?: string
}

type MentionPayload = BasePayload & {
  senderLabel: string
  content: string
  channelName?: string
}

type DirectMessagePayload = BasePayload & {
  senderLabel: string
  content: string
}

type FriendRequestPayload = BasePayload & {
  username: string
}

type FriendAcceptedPayload = BasePayload & {
  username: string
}

type IncomingCallPayload = BasePayload & {
  callerLabel: string
}

type MissedCallPayload = BasePayload & {
  callerLabel: string
  durationLabel?: string
}

type CallEndedPayload = BasePayload & {
  peerLabel: string
  durationLabel?: string
}

type SystemPayload = BasePayload & {
  title: string
  body: string
  priority?: NotificationPriority
}

export type NotificationPayloadMap = {
  channel_message: ChannelMessagePayload
  mention: MentionPayload
  direct_message: DirectMessagePayload
  friend_request: FriendRequestPayload
  friend_accepted: FriendAcceptedPayload
  incoming_call: IncomingCallPayload
  missed_call: MissedCallPayload
  call_ended: CallEndedPayload
  system: SystemPayload
}

type FormattedNotification = {
  title: string
  body: string
  priority: NotificationPriority
  dedupeKey: string
}

const DEDUPE_WINDOW_MS = 2_000
const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMIT_MAX_EVENTS = 6
const PREVIEW_MAX_LENGTH = 90

const recentByDedupeKey = new Map<string, number>()
const emittedAtTimestamps: number[] = []

export const NOTIFICATION_MATRIX: Record<NotificationEventType, NotificationMatrixEntry> = {
  channel_message: {
    preferenceKey: 'channelMessages',
    priority: 'normal',
    suppression: ['self', 'muted channel/server/user', 'active view + focused app'],
  },
  mention: {
    preferenceKey: 'mentions',
    priority: 'normal',
    suppression: ['self', 'muted channel/server/user', 'active view + focused app'],
  },
  direct_message: {
    preferenceKey: 'directMessages',
    priority: 'normal',
    suppression: ['self', 'muted user', 'active view + focused app'],
  },
  friend_request: {
    preferenceKey: 'friendRequests',
    priority: 'normal',
    suppression: [],
  },
  friend_accepted: {
    preferenceKey: 'friendAccepted',
    priority: 'silent',
    suppression: [],
  },
  incoming_call: {
    preferenceKey: 'incomingCalls',
    priority: 'normal',
    suppression: ['muted caller', 'already in active call with caller'],
  },
  missed_call: {
    preferenceKey: 'missedCalls',
    priority: 'normal',
    suppression: [],
  },
  call_ended: {
    preferenceKey: 'missedCalls',
    priority: 'silent',
    suppression: [],
  },
  system: {
    preferenceKey: null,
    priority: 'normal',
    suppression: [],
  },
}

function truncatePreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= PREVIEW_MAX_LENGTH) return normalized
  return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 1)}…`
}

function isAppFocused(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'visible' && document.hasFocus()
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function isQuietHoursActive(): boolean {
  const settings = useUiStore.getState().notificationSettings
  if (!settings.quietHoursEnabled) return false
  const start = timeToMinutes(settings.quietHoursStart)
  const end = timeToMinutes(settings.quietHoursEnd)
  if (start === null || end === null || start === end) return false
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  if (start < end) {
    return nowMinutes >= start && nowMinutes < end
  }
  return nowMinutes >= start || nowMinutes < end
}

function shouldRateLimit(now: number): boolean {
  while (emittedAtTimestamps.length > 0 && now - emittedAtTimestamps[0] > RATE_LIMIT_WINDOW_MS) {
    emittedAtTimestamps.shift()
  }
  return emittedAtTimestamps.length >= RATE_LIMIT_MAX_EVENTS
}

function seenRecently(dedupeKey: string, now: number): boolean {
  const lastSeen = recentByDedupeKey.get(dedupeKey)
  if (lastSeen !== undefined && now - lastSeen < DEDUPE_WINDOW_MS) {
    return true
  }
  recentByDedupeKey.set(dedupeKey, now)
  for (const [key, timestamp] of recentByDedupeKey.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS * 4) {
      recentByDedupeKey.delete(key)
    }
  }
  return false
}

function formatNotification<T extends NotificationEventType>(
  eventType: T,
  payload: NotificationPayloadMap[T],
): FormattedNotification {
  const settings = useUiStore.getState().notificationSettings
  const showPreviews = settings.showPreviews
  const basePriority = (payload as SystemPayload).priority ?? NOTIFICATION_MATRIX[eventType].priority

  switch (eventType) {
    case 'channel_message': {
      const typed = payload as ChannelMessagePayload
      return {
        title: typed.senderLabel,
        body: showPreviews ? truncatePreview(typed.content) : `New message in #${typed.channelName ?? 'channel'}`,
        priority: basePriority,
        dedupeKey: typed.dedupeKey ?? `channel_message:${typed.senderLabel}:${typed.channelName ?? ''}:${typed.content}`,
      }
    }
    case 'mention': {
      const typed = payload as MentionPayload
      return {
        title: `${typed.senderLabel} mentioned you`,
        body: showPreviews ? truncatePreview(typed.content) : `Mention in #${typed.channelName ?? 'channel'}`,
        priority: basePriority,
        dedupeKey: typed.dedupeKey ?? `mention:${typed.senderLabel}:${typed.channelName ?? ''}:${typed.content}`,
      }
    }
    case 'direct_message': {
      const typed = payload as DirectMessagePayload
      return {
        title: typed.senderLabel,
        body: showPreviews ? truncatePreview(typed.content) : 'New direct message',
        priority: basePriority,
        dedupeKey: typed.dedupeKey ?? `direct_message:${typed.senderLabel}:${typed.content}`,
      }
    }
    case 'friend_request': {
      const typed = payload as FriendRequestPayload
      return {
        title: 'Friend Request',
        body: `New friend request from ${typed.username}`,
        priority: basePriority,
        dedupeKey: typed.dedupeKey ?? `friend_request:${typed.username}`,
      }
    }
    case 'friend_accepted': {
      const typed = payload as FriendAcceptedPayload
      return {
        title: 'Friend Request Accepted',
        body: `${typed.username} accepted your friend request`,
        priority: basePriority,
        dedupeKey: typed.dedupeKey ?? `friend_accepted:${typed.username}`,
      }
    }
    case 'incoming_call': {
      const typed = payload as IncomingCallPayload
      return {
        title: 'Incoming call',
        body: `${typed.callerLabel} is calling you`,
        priority: basePriority,
        dedupeKey: typed.dedupeKey ?? `incoming_call:${typed.callerLabel}`,
      }
    }
    case 'missed_call': {
      const typed = payload as MissedCallPayload
      const duration = typed.durationLabel ? ` (${typed.durationLabel})` : ''
      return {
        title: 'Missed call',
        body: `You missed a call from ${typed.callerLabel}${duration}`,
        priority: basePriority,
        dedupeKey: typed.dedupeKey ?? `missed_call:${typed.callerLabel}:${typed.durationLabel ?? ''}`,
      }
    }
    case 'call_ended': {
      const typed = payload as CallEndedPayload
      return {
        title: 'Call ended',
        body: typed.durationLabel ? `${typed.peerLabel} call ended after ${typed.durationLabel}` : `${typed.peerLabel} call ended`,
        priority: basePriority,
        dedupeKey: typed.dedupeKey ?? `call_ended:${typed.peerLabel}:${typed.durationLabel ?? ''}`,
      }
    }
    case 'system': {
      const typed = payload as SystemPayload
      return {
        title: typed.title,
        body: truncatePreview(typed.body),
        priority: basePriority,
        dedupeKey: typed.dedupeKey ?? `system:${typed.title}:${typed.body}`,
      }
    }
    default: {
      const exhaustiveCheck: never = eventType
      void exhaustiveCheck
      return {
        title: 'Notification',
        body: '',
        priority: basePriority,
        dedupeKey: `fallback:${Date.now()}`,
      }
    }
  }
}

function shouldSuppressForPreferences<T extends NotificationEventType>(
  eventType: T,
  payload: NotificationPayloadMap[T],
): boolean {
  const settings = useUiStore.getState().notificationSettings
  if (!settings.enabled) return true
  if (isQuietHoursActive()) return true
  const preferenceKey = NOTIFICATION_MATRIX[eventType].preferenceKey
  if (preferenceKey && !settings.eventToggles[preferenceKey]) return true
  if ((payload as BasePayload).suppress) return true
  if ((payload as BasePayload).suppressIfFocusedAndActive && isAppFocused()) return true
  return false
}

export async function notify<T extends NotificationEventType>(
  eventType: T,
  payload: NotificationPayloadMap[T],
): Promise<boolean> {
  if (shouldSuppressForPreferences(eventType, payload)) return false

  const formatted = formatNotification(eventType, payload)
  const now = Date.now()
  if (seenRecently(formatted.dedupeKey, now)) return false
  if (shouldRateLimit(now)) return false

  emittedAtTimestamps.push(now)
  try {
    await tauriCommands.showNotification(formatted.title, formatted.body)
    return true
  } catch (error) {
    // keep diagnostics in dev while returning a reliable failure signal to callers
    if (import.meta.env.DEV) {
      console.warn('[notifications] failed to show OS notification', {
        eventType,
        title: formatted.title,
        error,
      })
    }
    return false
  }
}

export function getTotalUnreadCount(): number {
  const ui = useUiStore.getState()
  const channelUnread = Object.values(ui.unreadByChannel).reduce((sum, value) => sum + value, 0)
  const dmUnread = Object.values(ui.unreadByDmPartner).reduce((sum, value) => sum + value, 0)
  return channelUnread + dmUnread
}

export async function syncUnreadBadgeCount(): Promise<void> {
  await tauriCommands.setBadgeCount(getTotalUnreadCount()).catch(() => undefined)
}

export async function clearBadgeCount(): Promise<void> {
  await tauriCommands.setBadgeCount(0).catch(() => undefined)
}

export async function getNotificationPermission(): Promise<NotificationPermissionState> {
  return tauriCommands.getNotificationPermission()
}

export async function ensureNotificationPermission(options?: { prompt?: boolean }): Promise<NotificationPermissionState> {
  const prompt = options?.prompt ?? false
  const current = await tauriCommands.getNotificationPermission()
  if (!prompt || current !== 'default') return current
  return tauriCommands.requestNotificationPermission()
}

export async function sendTestNotification(): Promise<boolean> {
  const permission = await ensureNotificationPermission({ prompt: true })
  if (permission === 'denied' || permission === 'unsupported') {
    return false
  }
  return notify('system', {
    title: 'LetsChat',
    body: 'Notifications are configured correctly.',
    dedupeKey: `test:${Date.now()}`,
  })
}

export function normalizeNotificationIdentity(identity: Identity): Identity {
  return identity.trim().toLowerCase() as Identity
}
