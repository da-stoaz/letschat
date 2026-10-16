import { MailCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthStatusScreen } from './AuthStatusScreen'
import { ConfirmationEmailActions } from './ConfirmationEmailActions'
import type { PendingRegistration } from './state'

export function ConfirmEmailScreen({ pending, onBack, onEmailChanged }: {
  pending: PendingRegistration
  onBack: () => void
  onEmailChanged: (email: string) => void
}) {
  return (
    <AuthStatusScreen
      icon={<MailCheckIcon className="size-6 text-primary" />}
      title="Confirm your email"
      description={<>
        We sent a confirmation link to{' '}
        <span className="font-medium text-foreground">{pending.email}</span>. Open it — this
        screen updates automatically once you do.
      </>}
    >
      <ConfirmationEmailActions key={pending.username} username={pending.username} onEmailChanged={onEmailChanged} />
      <Button type="button" variant="ghost" className="w-full" onClick={onBack}>Back to sign in</Button>
    </AuthStatusScreen>
  )
}
