import { useCallback, useEffect, useRef, useState } from 'react'
import { BellIcon, CameraIcon, Loader2Icon, LogOutIcon, PlugZapIcon, ShieldCheckIcon, Trash2Icon, UserRoundIcon } from 'lucide-react'
import { ConnectionTab } from './ConnectionTab'
import { getCurrentSessionToken, reducers, signOut } from '../../lib/spacetimedb'
import { authServiceLink } from '../../lib/authService'
import { uploadSingleFile } from '../../lib/uploads'
import {
  ensureNotificationPermission,
  getNotificationPermission,
  sendTestNotification,
  type NotificationEventType,
} from '../../lib/notifications'
import { isDesktopTauriRuntime } from '../../lib/tauri'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSelfStore } from '../../stores/selfStore'
import { useUiStore } from '../../stores/uiStore'
import { toast } from '@/components/ui/sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

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
    label: 'Server messages',
    description: 'New text messages from server channels.',
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

const MAX_AVATAR_SIZE_BYTES = 10 * 1024 * 1024
const PRIORITY_NOTIFICATION_KEYS: NotificationToggleRow['key'][] = ['mentions', 'directMessages', 'incomingCalls']

function normalizeTimeInput(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return value
  const hours = Math.min(23, Math.max(0, Number(match[1])))
  const minutes = Math.min(59, Math.max(0, Number(match[2])))
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function SettingsPanel() {
  const user = useSelfStore((s) => s.user)
  const identity = useConnectionStore((s) => s.identity)
  const notificationSettings = useUiStore((s) => s.notificationSettings)
  const setNotificationsEnabled = useUiStore((s) => s.setNotificationsEnabled)
  const setNotificationEventEnabled = useUiStore((s) => s.setNotificationEventEnabled)
  const setNotificationPreviewsEnabled = useUiStore((s) => s.setNotificationPreviewsEnabled)
  const setNotificationQuietHoursEnabled = useUiStore((s) => s.setNotificationQuietHoursEnabled)
  const setNotificationQuietHoursRange = useUiStore((s) => s.setNotificationQuietHoursRange)

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [quietHoursStart, setQuietHoursStart] = useState(notificationSettings.quietHoursStart)
  const [quietHoursEnd, setQuietHoursEnd] = useState(notificationSettings.quietHoursEnd)
  const [permissionState, setPermissionState] = useState<'granted' | 'denied' | 'default' | 'unsupported'>('default')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [accountMessage, setAccountMessage] = useState<string | null>(null)
  const isTauri = isDesktopTauriRuntime()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const clearAvatarPreview = useCallback(() => {
    setAvatarPreviewUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return null
    })
  }, [])

  const setAvatarPreviewFromFile = useCallback((file: File) => {
    setAvatarPreviewUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return URL.createObjectURL(file)
    })
  }, [])

  const handleAvatarFilePicked = useCallback(
    (file: File | null) => {
      if (!file) return

      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file.')
        return
      }
      if (file.size > MAX_AVATAR_SIZE_BYTES) {
        toast.error('Profile picture is too large. Max size is 10 MB.')
        return
      }

      setIsUploadingAvatar(true)
      void uploadSingleFile(file)
        .then((uploaded) => {
          setAvatarUrl(uploaded.storageKey)
          setAvatarPreviewFromFile(file)
          toast.success('Profile picture uploaded')
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Could not upload profile picture.'
          toast.error(message)
        })
        .finally(() => {
          setIsUploadingAvatar(false)
        })
    },
    [setAvatarPreviewFromFile],
  )

  useEffect(() => {
    setDisplayName(user?.displayName ?? '')
    clearAvatarPreview()
    setAvatarUrl(user?.avatarUrl ?? '')
  }, [clearAvatarPreview, user?.avatarUrl, user?.displayName])

  useEffect(
    () => () => {
      if (avatarPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(avatarPreviewUrl)
    },
    [avatarPreviewUrl],
  )

  useEffect(() => {
    setQuietHoursStart(notificationSettings.quietHoursStart)
    setQuietHoursEnd(notificationSettings.quietHoursEnd)
  }, [notificationSettings.quietHoursEnd, notificationSettings.quietHoursStart])

  useEffect(() => {
    let active = true
    void getNotificationPermission().then((permission) => {
      if (active) setPermissionState(permission)
    })
    return () => {
      active = false
    }
  }, [])

  const profileDisplayName = displayName.trim() || user?.displayName || user?.username || 'No display name'
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
        disabled={!notificationSettings.enabled}
      />
    </div>
  )

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Update your identity, secure access, control notifications, and manage server connection details.
        </p>
      </header>

      <Tabs defaultValue="identity" className="space-y-3">
        <TabsList className="w-full">
          <TabsTrigger value="identity" className="flex-1 min-w-0">
            <UserRoundIcon className="size-3.5" />
            Identity
          </TabsTrigger>
          <TabsTrigger value="security" className="flex-1 min-w-0">
            <ShieldCheckIcon className="size-3.5" />
            Security
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex-1 min-w-0">
            <BellIcon className="size-3.5" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="connection" className="flex-1 min-w-0">
            <PlugZapIcon className="size-3.5" />
            Connection
          </TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
            <Card className="border-border/70 bg-muted/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Profile Preview</CardTitle>
                <CardDescription>What other members recognize first in chat and member lists.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/70 p-3">
                  <Avatar className="size-14 rounded-2xl">
                    {avatarPreviewUrl || avatarUrl ? (
                      <AvatarImage src={avatarPreviewUrl ?? avatarUrl} alt={profileDisplayName} />
                    ) : null}
                    <AvatarFallback className="rounded-2xl bg-primary/10 text-sm">
                      {profileDisplayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{profileDisplayName}</p>
                    <p className="truncate text-xs text-muted-foreground">{user ? `@${user.username}` : 'No username set'}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-card/70 p-3">
                  <p className="text-xs text-muted-foreground">
                    Keep this updated so friends and teammates can identify you quickly.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-muted/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Edit Identity</CardTitle>
                <CardDescription>Update display name and avatar in one flow.</CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-4"
                  onSubmit={async (event) => {
                    event.preventDefault()
                    setIsSavingProfile(true)
                    try {
                      const normalizedAvatar = avatarUrl.trim()
                      await reducers.updateProfile(displayName || null, normalizedAvatar)
                      toast.success('Profile updated')
                    } catch (error) {
                      const message = error instanceof Error ? error.message : 'Could not save profile.'
                      toast.error(message)
                    } finally {
                      setIsSavingProfile(false)
                    }
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="settings-display-name">Display name</Label>
                    <Input
                      id="settings-display-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Display name"
                    />
                  </div>

                  <div className="space-y-3 rounded-lg border border-border/70 bg-card/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-sm">Profile picture</Label>
                        <p className="text-xs text-muted-foreground">
                          Upload an image to use as your avatar across chats and calls.
                        </p>
                      </div>
                      <Avatar className="size-16 rounded-2xl">
                        {avatarPreviewUrl || avatarUrl ? (
                          <AvatarImage src={avatarPreviewUrl ?? avatarUrl} alt={profileDisplayName} />
                        ) : null}
                        <AvatarFallback className="rounded-2xl bg-primary/10 text-lg">
                          {profileDisplayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </div>

                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null
                        event.currentTarget.value = ''
                        handleAvatarFilePicked(file)
                      }}
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isUploadingAvatar}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        {isUploadingAvatar ? <Loader2Icon className="size-4 animate-spin" /> : <CameraIcon className="size-4" />}
                        {isUploadingAvatar ? 'Uploading…' : 'Change Photo'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isUploadingAvatar || (!avatarPreviewUrl && !avatarUrl)}
                        onClick={() => {
                          clearAvatarPreview()
                          setAvatarUrl('')
                          toast.message('Profile picture will be removed after saving.')
                        }}
                      >
                        <Trash2Icon className="size-4" />
                        Remove
                      </Button>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={isSavingProfile || isUploadingAvatar}>
                      {isSavingProfile ? 'Saving…' : 'Save Profile'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="security">
          <div className="space-y-3">
            <Card className="border-border/70 bg-muted/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Identity Binding</CardTitle>
                <CardDescription>Confirm which account identity this client is operating as.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 rounded-lg border border-border/70 bg-card/70 p-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Username</p>
                    <Badge variant="secondary">{user ? `@${user.username}` : 'Unregistered identity'}</Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Identity</p>
                    <p className="break-all text-xs text-muted-foreground">{identity ?? 'No identity available'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-muted/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Password Login</CardTitle>
                <CardDescription>Set a password so you can sign in from another device with your username.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2 rounded-lg border border-border/70 bg-card/70 p-3">
                  <Label htmlFor="settings-password">Password</Label>
                  <Input
                    id="settings-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Links this identity to username/password sign in.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSavingPassword}
                      onClick={async () => {
                        setAccountMessage(null)
                        if (!user) {
                          setAccountMessage('Register a user first.')
                          return
                        }
                        if (!identity) {
                          setAccountMessage('No active identity found.')
                          return
                        }
                        const sessionToken = getCurrentSessionToken()
                        if (!sessionToken) {
                          setAccountMessage('No active Spacetime session token found.')
                          return
                        }
                        if (password.length < 8) {
                          setAccountMessage('Password must be at least 8 characters.')
                          return
                        }
                        if (password !== confirmPassword) {
                          setAccountMessage('Passwords do not match.')
                          return
                        }

                        setIsSavingPassword(true)
                        try {
                          await authServiceLink({
                            username: user.username,
                            displayName: user.displayName,
                            password,
                            spacetimeToken: sessionToken,
                            spacetimeIdentity: identity,
                          })
                          setPassword('')
                          setConfirmPassword('')
                          setAccountMessage('Password login updated successfully.')
                          toast.success('Password login updated')
                        } catch (error) {
                          const message = error instanceof Error ? error.message : 'Could not update password login.'
                          setAccountMessage(message)
                          toast.error(message)
                        } finally {
                          setIsSavingPassword(false)
                        }
                      }}
                    >
                      {isSavingPassword ? 'Saving…' : 'Save Password Login'}
                    </Button>
                  </div>
                </div>

                {accountMessage ? <p className="text-xs text-muted-foreground">{accountMessage}</p> : null}
              </CardContent>
            </Card>

            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-destructive">Session Actions</CardTitle>
                <CardDescription>Use this when you want to sign out from this device immediately.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Disconnect this client and clear authenticated session tokens.
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isSigningOut}
                  onClick={async () => {
                    setIsSigningOut(true)
                    try {
                      await signOut()
                      window.location.assign('/auth')
                    } catch (error) {
                      const message = error instanceof Error ? error.message : 'Could not sign out.'
                      toast.error(message)
                      setIsSigningOut(false)
                    }
                  }}
                >
                  <LogOutIcon className="size-4" />
                  {isSigningOut ? 'Signing out…' : 'Sign Out'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <div className="space-y-3">
            <Card className="border-border/70 bg-muted/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notification Master Control</CardTitle>
                <CardDescription>
                  Choose between quiet mode and full awareness in one place.
                </CardDescription>
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
                    disabled={!notificationSettings.enabled}
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
                      disabled={!notificationSettings.enabled}
                    />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="quiet-hours-start">Start</Label>
                      <Input
                        id="quiet-hours-start"
                        type="time"
                        value={quietHoursStart}
                        disabled={!notificationSettings.enabled || !notificationSettings.quietHoursEnabled}
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
                        disabled={!notificationSettings.enabled || !notificationSettings.quietHoursEnabled}
                        onChange={(event) => setQuietHoursEnd(event.target.value)}
                        onBlur={() =>
                          setNotificationQuietHoursRange(normalizeTimeInput(quietHoursStart), normalizeTimeInput(quietHoursEnd))
                        }
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

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
        </TabsContent>

        <TabsContent value="connection">
          <ConnectionTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}
