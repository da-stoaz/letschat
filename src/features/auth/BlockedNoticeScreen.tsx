import { ClockIcon, MailCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthStatusScreen } from './AuthStatusScreen'
import { ConfirmationEmailActions } from './ConfirmationEmailActions'
import type { LoginNotice } from './state'

export function BlockedNoticeScreen({ notice, onBack }: {
  notice: LoginNotice
  onBack: () => void
}) {
  return (
    <AuthStatusScreen
      icon={notice.kind === 'approval' ? <ClockIcon className="size-6 text-primary" /> : <MailCheckIcon className="size-6 text-primary" />}
      title={notice.title}
      description={notice.message}
    >
      {notice.kind === 'email' && notice.username ? <ConfirmationEmailActions key={notice.username} username={notice.username} /> : null}
      <Button type="button" variant="ghost" className="w-full" onClick={onBack}>Back to sign in</Button>
    </AuthStatusScreen>
  )
}
