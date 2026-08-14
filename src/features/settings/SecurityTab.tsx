import { useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { signOut } from '../../lib/spacetimedb'
import { authServiceChangePassword } from '../../lib/authService'
import { toast } from '@/components/ui/sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const MIN_PASSWORD_LENGTH = 8

export function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  // Only complain once the user has actually typed something in the field.
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canSubmit =
    currentPassword.length > 0 && newPassword.length >= MIN_PASSWORD_LENGTH && newPassword === confirmPassword

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      await authServiceChangePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password changed')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not change your password.'
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>
            You sign in with your username and this password. Changing it does not sign out your other devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="max-w-sm space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={tooShort}
                aria-describedby="new-password-hint"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p
                id="new-password-hint"
                className={`text-xs ${tooShort ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={mismatch}
                aria-describedby={mismatch ? 'confirm-password-error' : undefined}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {mismatch ? (
                <p id="confirm-password-error" className="text-xs text-destructive">
                  Passwords do not match.
                </p>
              ) : null}
            </div>

            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={!canSubmit || isSaving}>
              {isSaving ? 'Changing…' : 'Change password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sign out</CardTitle>
          <CardDescription>Disconnects this client and clears its saved session.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            disabled={isSigningOut}
            onClick={async () => {
              setIsSigningOut(true)
              try {
                await signOut()
                window.location.assign('/auth')
              } catch (caught) {
                const message = caught instanceof Error ? caught.message : 'Could not sign out.'
                toast.error(message)
                setIsSigningOut(false)
              }
            }}
          >
            <LogOutIcon className="size-4" />
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
