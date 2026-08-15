import { useEffect, useState } from 'react'
import {
  ensureNotificationPermission,
  getNotificationPermission,
  sendTestNotification,
  type NotificationEventType,
} from '../../lib/notifications'
import { isDesktopTauriRuntime } from '../../lib/tauri'
import { useUiStore } from '../../stores/uiStore'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

type NotificationToggleRow = {
  event: NotificationEventType
  key:
    | 'channelMessages'
    | 'directMessages'
    | 'friendRequests'
    | 'friendAccepted'
    | 'incomingCalls'
    | 'missedCalls'
    | 'mentions'
  label: string
  description: string
}

const NOTIFICATION_TOGGLE_ROWS: NotificationToggleRow[] = [
  {
    event: 'channel_message',
    key: 'channelMessages',
    label: 'Space messages',
    description: 'New text messages from space channels.',
  },
  {
    event: 'mention',
    key: 'mentions',
    label: 'Mentions',
    description: 'Messages that include your @username or @display name.',
  },
  {
    event: 'direct_message',
    key: 'directMessages',
    label: 'Direct messages',
    description: 'New direct messages from friends.',
  },
  {
    event: 'friend_request',
    key: 'friendRequests',
    label: 'Friend requests',
    description: 'Incoming friend requests.',
  },
  {
    event: 'friend_accepted',
    key: 'friendAccepted',
    label: 'Friend accepted',
    description: 'When someone accepts your friend request.',
  },
  {
    event: 'incoming_call',
    key: 'incomingCalls',
    label: 'Incoming calls',
    description: 'Ring notifications for incoming DM calls.',
  },
  {
    event: 'missed_call',
    key: 'missedCalls',
    label: 'Missed/call ended',
    description: 'Missed call and call-ended summaries.',
  },
]

const PRIORITY_NOTIFICATION_KEYS: NotificationToggleRow['key'][] = ['mentions', 'directMessages', 'incomingCalls']

function normalizeTimeInput(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return value
  const hours = Math.min(23, Math.max(0, Number(match[1])))
  const minutes = Math.min(59, Math.max(0, Number(match[2])))
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function NotificationsTab() {
  const notificationSettings = useUiStore((s) => s.notificationSettings)
  const setNotificationsEnabled = useUiStore((s) => s.setNotificationsEnabled)
  const setNotificationEventEnabled = useUiStore((s) => s.setNotificationEventEnabled)
  const setNotificationPreviewsEnabled = useUiStore((s) => s.setNotificationPreviewsEnabled)
  const setNotificationQuietHoursEnabled = useUiStore((s) => s.setNotificationQuietHoursEnabled)
  const setNotificationQuietHoursRange = useUiStore((s) => s.setNotificationQuietHoursRange)

  const [quietHoursStart, setQuietHoursStart] = useState(notificationSettings.quietHoursStart)
  const [quietHoursEnd, setQuietHoursEnd] = useState(notificationSettings.quietHoursEnd)
  const [permissionState, setPermissionState] = useState<'granted' | 'denied' | 'default' | 'unsupported'>('default')
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)
  const [isSendingTest, setIsSendingTest] = useState(false)
  const isTauri = isDesktopTauriRuntime()

  useEffect(() => {
    let active = true
    void getNotificationPermission().then((permission) => {
      if (active) setPermissionState(permission)
    })
    return () => {
      active = false
    }
  }, [])

  const priorityNotificationRows = NOTIFICATION_TOGGLE_ROWS.filter((row) => PRIORITY_NOTIFICATION_KEYS.includes(row.key))
  const secondaryNotificationRows = NOTIFICATION_TOGGLE_ROWS.filter((row) => !PRIORITY_NOTIFICATION_KEYS.includes(row.key))
  const enabledNotificationCount = NOTIFICATION_TOGGLE_ROWS.reduce((total, row) => {
    return total + (notificationSettings.eventToggles[row.key] ? 1 : 0)
  }, 0)

  const renderNotificationToggleRow = (row: NotificationToggleRow) => (
    <div key={row.event} className="flex items-center justify-between gap-3 py-1.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{row.label}</p>
        <p className="text-xs text-muted-foreground">{row.description}</p>
      </div>
      <Switch
        checked={notificationSettings.eventToggles[row.key]}
        onCheckedChange={(checked) => setNotificationEventEnabled(row.key, Boolean(checked))}
      />
    </div>
  )

  return (
    <div className="space-y-3">
      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notification Master Control</CardTitle>
          <CardDescription>Choose between quiet mode and full awareness in one place.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/70 p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Enable notifications</p>
              <p className="text-xs text-muted-foreground">Master switch for all desktop/browser notifications.</p>
            </div>
            <Switch
              checked={notificationSettings.enabled}
              onCheckedChange={(checked) => setNotificationsEnabled(Boolean(checked))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {notificationSettings.enabled
              ? `Enabled for ${enabledNotificationCount} of ${NOTIFICATION_TOGGLE_ROWS.length} event types.`
              : 'Notifications are currently disabled globally.'}
          </p>
        </CardContent>
      </Card>

      {/* Everything below depends on the master switch — collapsed rather than
          left greyed-out, per CLAUDE-UI.md. */}
      {notificationSettings.enabled ? (
        <>
        <Card className="border-border/70 bg-muted/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Priority Alerts</CardTitle>
            <CardDescription>Keep these on if you never want to miss direct attention.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 rounded-lg border border-border/70 bg-card/70 p-3">
            {priorityNotificationRows.map((row) => renderNotificationToggleRow(row))}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-muted/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Everything Else</CardTitle>
            <CardDescription>Lower-priority updates you can tune based on preference.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 rounded-lg border border-border/70 bg-card/70 p-3">
            {secondaryNotificationRows.map((row) => renderNotificationToggleRow(row))}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-muted/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Privacy & Schedule</CardTitle>
            <CardDescription>Control what is shown and when alerts are suppressed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/70 p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Show message previews</p>
                <p className="text-xs text-muted-foreground">Hide content in notification bodies when disabled.</p>
              </div>
              <Switch
                checked={notificationSettings.showPreviews}
                onCheckedChange={(checked) => setNotificationPreviewsEnabled(Boolean(checked))}
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 bg-card/70 p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Quiet hours</p>
                  <p className="text-xs text-muted-foreground">Suppress all notifications during this time range.</p>
                </div>
                <Switch
                  checked={notificationSettings.quietHoursEnabled}
                  onCheckedChange={(checked) => setNotificationQuietHoursEnabled(Boolean(checked))}
                />
              </div>

              {notificationSettings.quietHoursEnabled ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="quiet-hours-start">Start</Label>
                    <Input
                      id="quiet-hours-start"
                      type="time"
                      value={quietHoursStart}
                      onChange={(event) => setQuietHoursStart(event.target.value)}
                      onBlur={() =>
                        setNotificationQuietHoursRange(normalizeTimeInput(quietHoursStart), normalizeTimeInput(quietHoursEnd))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="quiet-hours-end">End</Label>
                    <Input
                      id="quiet-hours-end"
                      type="time"
                      value={quietHoursEnd}
                      onChange={(event) => setQuietHoursEnd(event.target.value)}
                      onBlur={() =>
                        setNotificationQuietHoursRange(normalizeTimeInput(quietHoursStart), normalizeTimeInput(quietHoursEnd))
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
        </>
      ) : null}


      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Permission & Test</CardTitle>
          <CardDescription>Verify runtime permission and test delivery quickly.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/70 p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Permission state</p>
              <p className="text-xs text-muted-foreground">Current runtime notification permission: {permissionState}</p>
              {isTauri ? (
                <p className="text-xs text-muted-foreground">
                  Desktop permission is managed by macOS/Windows system settings for LetsChat.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRequestingPermission}
                onClick={async () => {
                  setIsRequestingPermission(true)
                  try {
                    if (isTauri) {
                      const permission = await getNotificationPermission()
                      setPermissionState(permission)
                      toast.message('Notification permission is managed by your OS settings for LetsChat.')
                      return
                    }
                    const permission = await ensureNotificationPermission({ prompt: true })
                    setPermissionState(permission)
                    if (permission === 'granted') {
                      toast.success('Notification permission granted')
                    } else if (permission === 'denied') {
                      toast.error('Notification permission denied')
                    } else if (permission === 'unsupported') {
                      toast.error('Notifications are not supported in this runtime')
                    }
                  } finally {
                    setIsRequestingPermission(false)
                  }
                }}
              >
                {isRequestingPermission ? 'Requesting…' : 'Request Permission'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isSendingTest}
                onClick={async () => {
                  setIsSendingTest(true)
                  try {
                    const shown = await sendTestNotification()
                    const permission = await getNotificationPermission()
                    setPermissionState(permission)
                    if (shown) {
                      toast.success('Test notification sent')
                    } else {
                      toast.error('Could not send test notification. Check permission/settings.')
                    }
                  } finally {
                    setIsSendingTest(false)
                  }
                }}
              >
                {isSendingTest ? 'Sending…' : 'Test notification'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
