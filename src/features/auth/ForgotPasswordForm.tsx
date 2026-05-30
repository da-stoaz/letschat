import { useState } from 'react'
import { ArrowLeftIcon, MailCheckIcon } from 'lucide-react'
import { authServiceForgotPassword } from '../../lib/authService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthStatusScreen } from './AuthStatusScreen'

/**
 * Standalone "reset your password" action. Reached from a link under the
 * sign-in form rather than the tab bar — it's a recovery path, not a first-want
 * action — and owns its own state so it never inherits a stale sign-in error.
 *
 * The reset itself happens in the browser via the emailed link (mirroring email
 * confirmation); this view only kicks off that email. The response is always
 * generic, so success never reveals whether the address has an account.
 */
export function ForgotPasswordForm({
  defaultEmail = '',
  onBack,
}: {
  defaultEmail?: string
  onBack: () => void
}) {
  const [email, setEmail] = useState(defaultEmail)
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')

  if (status === 'sent') {
    return (
      <AuthStatusScreen
        icon={<MailCheckIcon className="size-6 text-primary" />}
        title="Check your inbox"
        description={
          <>
            If <span className="font-medium text-foreground">{email.trim()}</span> has an account,
            we&rsquo;ve sent a link to reset your password. Open it in your browser to choose a new
            one.
          </>
        }
      >
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          Back to sign in
        </Button>
      </AuthStatusScreen>
    )
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        if (status === 'sending' || !email.trim()) return
        setStatus('sending')
        try {
          await authServiceForgotPassword(email.trim())
        } catch {
          // Generic by design — never reveal whether the address exists.
        }
        setStatus('sent')
      }}
    >
      <p className="text-sm text-muted-foreground">
        Enter the email address on your account and we&rsquo;ll send a link to reset your password.
      </p>
      <div className="space-y-2">
        <Label htmlFor="forgot-email">Email</Label>
        <Input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          placeholder="you@example.com"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          autoComplete="email"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" className="gap-1.5" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
          Back to sign in
        </Button>
        <Button type="submit" className="min-w-36" disabled={status === 'sending' || !email.trim()}>
          {status === 'sending' ? 'Sending…' : 'Send reset link'}
        </Button>
      </div>
    </form>
  )
}
