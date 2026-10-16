import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authServiceCorrectRegistrationEmail } from '@/lib/authService'
import { readCorrectionCooldown } from './confirmationCooldown'

export function CorrectEmailForm({ username, onChanged, cooldownSeconds, disabled, onSavingChange }: {
  username: string
  onChanged?: (email: string) => void
  cooldownSeconds: number
  disabled: boolean
  onSavingChange: (saving: boolean) => void
}) {
  const formId = useId()
  const busy = useRef(false)
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  return (
    <div className="space-y-2">
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      {editing ? (
        <form id={formId} className="space-y-3 text-left" onSubmit={async event => {
          event.preventDefault()
          if (busy.current || disabled || readCorrectionCooldown(username) > Date.now()) return
          busy.current = true
          setSaving(true)
          onSavingChange(true)
          setError(null)
          try {
            const result = await authServiceCorrectRegistrationEmail({ username, password, email })
            onChanged?.(result.email)
            setMessage(result.confirmationSent
              ? `Confirmation link sent to ${result.email}.`
              : `Email changed to ${result.email}, but sending failed. Please resend the confirmation email.`)
            setPassword('')
            setEditing(false)
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not change the email address.')
          } finally {
            busy.current = false
            setSaving(false)
            onSavingChange(false)
          }
        }}>
          <label className="block space-y-1 text-sm">
            <span>Correct email address</span>
            <Input type="email" autoComplete="email" required maxLength={256} value={email} onChange={event => setEmail(event.target.value)} disabled={saving} />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Password for {username}</span>
            <Input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={saving} />
          </label>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || disabled || cooldownSeconds > 0}>{saving ? 'Saving…' : cooldownSeconds > 0 ? `Change email in ${cooldownSeconds}s` : 'Change email'}</Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => { setEditing(false); setPassword(''); setError(null) }}>Cancel</Button>
          </div>
        </form>
      ) : <p className="text-xs text-muted-foreground">Wrong email?{' '}
        <button type="button" aria-expanded={editing} aria-controls={formId} disabled={disabled || cooldownSeconds > 0}
          className="rounded-sm underline underline-offset-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => { setEditing(true); setMessage(null) }}>{cooldownSeconds > 0 ? `Change address in ${cooldownSeconds}s` : 'Change address'}</button>
      </p>}
    </div>
  )
}
