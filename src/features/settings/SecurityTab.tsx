import { useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { signOut } from '../../lib/spacetimedb'
import { changePassword } from '../../lib/spacetimedb/auth'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLengthError } from '../../lib/authService'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  // Only complain once the user has actually typed something in the field.
  const lengthHint = newPassword.length > 0 ? passwordLengthError(newPassword) : null
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canSubmit =
    currentPassword.length > 0 && passwordLengthError(newPassword) === null && newPassword === confirmPassword

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password changed — other devices have been signed out')
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
                aria-invalid={lengthHint !== null}
                aria-describedby="new-password-hint"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p
                id="new-password-hint"
                className={`text-xs ${lengthHint ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {lengthHint ?? `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`}
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
