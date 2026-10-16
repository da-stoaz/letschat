import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { authServiceResendConfirmation } from '@/lib/authService'
import { CorrectEmailForm } from './CorrectEmailForm'
import { confirmationCooldownKey, readConfirmationCooldown, readCorrectionCooldown, startConfirmationCooldown, INITIAL_CONFIRMATION_COOLDOWN_MS } from './confirmationCooldown'

export function ConfirmationEmailActions({ username, onEmailChanged }: {
  username: string
  onEmailChanged?: (email: string) => void
}) {
  const [until, setUntil] = useState(() => readConfirmationCooldown(username) || Date.now() + INITIAL_CONFIRMATION_COOLDOWN_MS)
  const [now, setNow] = useState(Date.now)
  const [sending, setSending] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const busy = useRef(false)
  const seconds = Math.max(0, Math.ceil((until - now) / 1000))
  const correctionSeconds = Math.max(0, Math.ceil((readCorrectionCooldown(username) - now) / 1000))

  useEffect(() => {
    const key = confirmationCooldownKey(username)
    localStorage.setItem(key, String(until))
    const timer = setInterval(() => setNow(Date.now()), 1000)
    const onStorage = (event: StorageEvent) => {
      if (event.key === key && event.newValue) setUntil(Number(event.newValue))
    }
    window.addEventListener('storage', onStorage)
    return () => { clearInterval(timer); window.removeEventListener('storage', onStorage) }
  }, [until, username])

  return (
    <div className="space-y-4">
      <CorrectEmailForm username={username} cooldownSeconds={correctionSeconds} disabled={sending} onSavingChange={setCorrecting} onChanged={email => {
        setUntil(startConfirmationCooldown(username))
        setNow(Date.now())
        setMessage(null)
        onEmailChanged?.(email)
      }} />
      <Button type="button" variant="outline" className="w-full" disabled={sending || correcting || seconds > 0} onClick={async () => {
        if (busy.current || Math.max(until, readConfirmationCooldown(username)) > Date.now()) return
        busy.current = true
        setSending(true)
        setMessage(null)
        setUntil(startConfirmationCooldown(username))
        setNow(Date.now())
        try {
          await authServiceResendConfirmation({ username })
          setMessage('Check your inbox and spam folder for the confirmation email.')
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Could not request a new confirmation email.')
        } finally {
          busy.current = false
          setSending(false)
        }
      }}>
        {sending ? 'Sending…' : seconds > 0 ? `Resend email in ${seconds}s` : 'Resend confirmation email'}
      </Button>
      {message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}
