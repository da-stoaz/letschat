import { useState } from 'react'
import { ClockIcon, MailCheckIcon } from 'lucide-react'
import { authServiceResendConfirmation } from '../../lib/authService'
import { Button } from '@/components/ui/button'
import { AuthStatusScreen } from './AuthStatusScreen'
import type { LoginNotice } from './state'

/**
 * Shown when sign-in is blocked for a known reason: the email isn't confirmed,
 * or the account is awaiting admin approval. The unconfirmed case offers a
 * resend (by username, since that's all the login attempt knew) so the user
 * isn't dead-ended when they have no email in their inbox.
 */
export function BlockedNoticeScreen({
  notice,
  onBack,
}: {
  notice: LoginNotice
  onBack: () => void
}) {
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const canResend = notice.kind === 'email' && Boolean(notice.username)

  return (
    <AuthStatusScreen
      icon={
        notice.kind === 'approval' ? (
          <ClockIcon className="size-6 text-primary" />
        ) : (
          <MailCheckIcon className="size-6 text-primary" />
        )
      }
      title={notice.title}
      description={notice.message}
    >
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-col gap-2">
        {canResend ? (
          <Button
            type="button"
            variant="outline"
            disabled={resend === 'sending'}
            onClick={async () => {
              if (resend === 'sending') return
              setError(null)
              setResend('sending')
              try {
                await authServiceResendConfirmation({ username: notice.username! })
                setResend('sent')
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not resend the email.')
                setResend('idle')
              }
            }}
          >
            {resend === 'sent'
              ? 'Confirmation email sent'
              : resend === 'sending'
                ? 'Sending…'
                : 'Resend confirmation email'}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    </AuthStatusScreen>
  )
}
