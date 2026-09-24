import { useState } from 'react'
import { changePassword } from '../../lib/spacetimedb/auth'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLengthError } from '../../lib/authService'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>Change password</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Your other devices will be signed out.</DialogDescription>
        </DialogHeader>
        {/* Lives inside DialogContent so closing the dialog unmounts it and clears the fields. */}
        <ChangePasswordForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      toast.success('Password changed — other devices have been signed out')
      onDone()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not change your password.'
      setError(message)
      setIsSaving(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
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
        <p id="new-password-hint" className={`text-xs ${lengthHint ? 'text-destructive' : 'text-muted-foreground'}`}>
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

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={!canSubmit || isSaving}>
          {isSaving ? 'Changing…' : 'Change password'}
        </Button>
      </DialogFooter>
    </form>
  )
}
