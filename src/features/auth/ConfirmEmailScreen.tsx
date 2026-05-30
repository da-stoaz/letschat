import { useState } from 'react'
import { MailCheckIcon } from 'lucide-react'
import { authServiceResendConfirmation } from '../../lib/authService'
import { Button } from '@/components/ui/button'
import { AuthStatusScreen } from './AuthStatusScreen'
import type { PendingRegistration } from './state'

/**
 * Shown after a registration that needs email confirmation. The parent polls
 * the account status in the background and swaps this screen out once the email
 * is confirmed; here the user can re-send the email or back out to sign-in.
 */
export function ConfirmEmailScreen({
  pending,
  onBack,
}: {
  pending: PendingRegistration
  onBack: () => void
}) {
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  return (
    <AuthStatusScreen
      icon={<MailCheckIcon className="size-6 text-primary" />}
      title="Confirm your email"
      description={
        <>
          We sent a confirmation link to{' '}
          <span className="font-medium text-foreground">{pending.email}</span>. Open it — this
          screen updates automatically once you do.
        </>
      }
    >
      <p className="text-xs text-muted-foreground">Waiting for confirmation…</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={resendState === 'sending'}
          onClick={async () => {
            if (resendState === 'sending') return
            setError(null)
            setResendState('sending')
            try {
              await authServiceResendConfirmation(pending.email)
              setResendState('sent')
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not resend the email.')
              setResendState('idle')
            }
          }}
        >
          {resendState === 'sent'
            ? 'Confirmation email sent'
            : resendState === 'sending'
              ? 'Sending…'
              : 'Resend confirmation email'}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    </AuthStatusScreen>
  )
}
