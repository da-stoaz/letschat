import { useState } from 'react'
import { persistCredentialForCurrentUser, reducers, resetLocalAuthSession } from '../lib/spacetimedb'
import { useConnectionStore } from '../stores/connectionStore'
import { useSelfStore } from '../stores/selfStore'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LogOutIcon } from 'lucide-react'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const user = useSelfStore((s) => s.user)
  const identity = useConnectionStore((s) => s.identity)
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [accountMessage, setAccountMessage] = useState<string | null>(null)

  return (
    <section className="space-y-4">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Update your profile and manage your local session.</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          try {
            await reducers.updateProfile(displayName || undefined, avatarUrl || undefined)
            onClose()
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not save settings.'
            setError(message)
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
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>

      <Card className="border-border/70 bg-muted/25 py-0">
        <CardHeader>
          <CardTitle className="text-sm">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{user ? `@${user.username}` : 'Unregistered identity'}</Badge>
          </div>
          <p className="break-all">{identity ? identity : 'No identity available'}</p>
          <div className="space-y-2 rounded-md border border-border/70 p-2">
            <Label htmlFor="settings-password">Login password</Label>
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                setAccountMessage(null)
                if (!user) {
                  setAccountMessage('Register a user first.')
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
                try {
                  await persistCredentialForCurrentUser(user.username, password)
                  setPassword('')
                  setConfirmPassword('')
                  setAccountMessage('Password login updated successfully.')
                } catch (e) {
                  const message = e instanceof Error ? e.message : 'Could not update password login.'
                  setAccountMessage(message)
                }
              }}
            >
              Save Password Login
            </Button>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              resetLocalAuthSession()
              window.location.assign('/auth')
            }}
          >
            <LogOutIcon className="size-4" />
            Sign Out (Reset Local Session)
          </Button>
          {accountMessage ? <p className="text-xs text-muted-foreground">{accountMessage}</p> : null}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  )
}
