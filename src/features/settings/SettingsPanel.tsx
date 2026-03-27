import { useState } from 'react'
import { LogOutIcon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react'
import { getCurrentSessionToken, reducers, signOut } from '../../lib/spacetimedb'
import { authServiceLink } from '../../lib/authService'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSelfStore } from '../../stores/selfStore'
import { toast } from '@/components/ui/sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function SettingsPanel() {
  const user = useSelfStore((s) => s.user)
  const identity = useConnectionStore((s) => s.identity)
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [accountMessage, setAccountMessage] = useState<string | null>(null)

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, account identity, and sign-in security.</p>
      </header>

      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRoundIcon className="size-4 text-muted-foreground" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              setIsSavingProfile(true)
              try {
                await reducers.updateProfile(displayName || undefined, avatarUrl || undefined)
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
            <div className="space-y-2">
              <Label htmlFor="settings-avatar">Avatar URL</Label>
              <Input
                id="settings-avatar"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isSavingProfile}>
                {isSavingProfile ? 'Saving…' : 'Save Profile'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheckIcon className="size-4 text-muted-foreground" />
            Account & Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <div className="space-y-2 rounded-lg border border-border/70 bg-card/70 p-3">
            <Label htmlFor="settings-password">Password Login</Label>
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
              <p className="text-xs text-muted-foreground">Link this identity to username/password sign in.</p>
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

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Sign out</p>
              <p className="text-xs text-muted-foreground">Disconnect this client and clear authenticated session tokens.</p>
            </div>
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
          </div>

          {accountMessage ? <p className="text-xs text-muted-foreground">{accountMessage}</p> : null}
        </CardContent>
      </Card>
    </section>
  )
}
