import { useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { signOut } from '../../lib/spacetimedb'
import { authServiceLink, getStoredAuthSessionToken } from '../../lib/authService'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSelfStore } from '../../stores/selfStore'
import { toast } from '@/components/ui/sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function SecurityTab() {
  const user = useSelfStore((s) => s.user)
  const identity = useConnectionStore((s) => s.identity)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Change your password</CardTitle>
          <CardDescription>Used to sign in with your username on another device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2 rounded-lg border border-border/70 bg-card/70 p-3">
            <Label htmlFor="settings-password">New password</Label>
            <Input
              id="settings-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSavingPassword}
                onClick={async () => {
                  setPasswordMessage(null)
                  if (!user) {
                    setPasswordMessage('Register a user first.')
                    return
                  }
                  if (!identity) {
                    setPasswordMessage('No active identity found.')
                    return
                  }
                  const sessionToken = getStoredAuthSessionToken()
                  if (!sessionToken) {
                    setPasswordMessage('No active sign-in session found.')
                    return
                  }
                  if (password.length < 8) {
                    setPasswordMessage('Password must be at least 8 characters.')
                    return
                  }
                  if (password !== confirmPassword) {
                    setPasswordMessage('Passwords do not match.')
                    return
                  }

                  setIsSavingPassword(true)
                  try {
                    await authServiceLink({
                      username: user.username,
                      displayName: user.displayName,
                      password,
                      sessionToken,
                    })
                    setPassword('')
                    setConfirmPassword('')
                    setPasswordMessage('Password updated successfully.')
                    toast.success('Password updated')
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'Could not update your password.'
                    setPasswordMessage(message)
                    toast.error(message)
                  } finally {
                    setIsSavingPassword(false)
                  }
                }}
              >
                {isSavingPassword ? 'Saving…' : 'Update password'}
              </Button>
            </div>
          </div>

          {passwordMessage ? <p className="text-xs text-muted-foreground">{passwordMessage}</p> : null}
        </CardContent>
      </Card>

      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-destructive">Sign out</CardTitle>
          <CardDescription>Use this when you want to sign out from this device immediately.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Disconnect this client and clear authenticated session tokens.</p>
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
  )
}
