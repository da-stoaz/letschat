import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2Icon, ClockIcon, MailCheckIcon, PlugZapIcon } from 'lucide-react'
import { useSelfStore } from '../stores/selfStore'
import { ConnectionTab } from '../features/settings/ConnectionTab'
import { AuthStatusScreen } from '../features/auth/AuthStatusScreen'
import { ConfirmEmailScreen } from '../features/auth/ConfirmEmailScreen'
import { CredentialsForm } from '../features/auth/CredentialsForm'
import { ForgotPasswordForm } from '../features/auth/ForgotPasswordForm'
import { useEmailConfirmationPoll } from '../features/auth/useEmailConfirmationPoll'
import {
  clearPendingRegistration,
  persistPendingRegistration,
  readPendingRegistration,
  type LoginNotice,
  type PendingRegistration,
} from '../features/auth/state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * Auth-screen orchestrator. Picks exactly one view to render and owns only the
 * state shared across them (the pending-registration slot + its background
 * confirmation poll, the blocked-account notice, the active view). Each view
 * lives in `features/auth/` and manages its own form state.
 */
export function AuthPage() {
  const navigate = useNavigate()
  const user = useSelfStore((s) => s.user)

  const [view, setView] = useState<'credentials' | 'forgot'>('credentials')
  const [connectionSheetOpen, setConnectionSheetOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [returnUsername, setReturnUsername] = useState('')

  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistration | null>(
    readPendingRegistration,
  )
  const [pendingConfirmed, setPendingConfirmed] = useState(false)
  // Held only in memory (never persisted) so the poll can finish sign-in
  // automatically once the email is confirmed in the same session.
  const [pendingPassword, setPendingPassword] = useState<string | null>(null)
  const [loginNotice, setLoginNotice] = useState<LoginNotice | null>(null)

  useEffect(() => {
    if (user) navigate('/app', { replace: true })
  }, [navigate, user])

  useEmailConfirmationPoll({
    pending: pendingRegistration,
    confirmed: pendingConfirmed,
    password: pendingPassword,
    onConfirmedManual: () => setPendingConfirmed(true),
    onSignedIn: () => setPendingRegistration(null),
    onBlocked: (notice) => {
      setPendingRegistration(null)
      setLoginNotice(notice)
    },
  })

  function backToSignIn() {
    clearPendingRegistration()
    if (pendingRegistration) setReturnUsername(pendingRegistration.username)
    setPendingRegistration(null)
    setPendingConfirmed(false)
    setPendingPassword(null)
    setLoginNotice(null)
    setView('credentials')
  }

  const headerDescription = pendingRegistration
    ? pendingConfirmed
      ? 'Your account is ready.'
      : 'One more step to activate your account.'
    : loginNotice
      ? 'This account is not ready to sign in yet.'
      : view === 'forgot'
        ? 'Reset your password.'
        : 'Sign in with your persisted account credentials.'

  return (
    <section className="relative grid min-h-screen place-items-center bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/25),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/20),transparent)] p-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute top-4 left-4 gap-1.5 border-border/70 bg-background/70 text-xs font-medium text-foreground/80 backdrop-blur-sm hover:bg-background hover:text-foreground"
        title="Connection settings"
        onClick={() => setConnectionSheetOpen(true)}
      >
        <PlugZapIcon className="size-3.5" />
        Connection
      </Button>
      <Sheet open={connectionSheetOpen} onOpenChange={setConnectionSheetOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Connection</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <ConnectionTab />
          </div>
        </SheetContent>
      </Sheet>
      <Card className="w-full max-w-md border-border/70 bg-card/90 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-2xl">LetsChat</CardTitle>
          <CardDescription>{headerDescription}</CardDescription>
        </CardHeader>
        <CardContent>{renderView()}</CardContent>
      </Card>
    </section>
  )

  function renderView() {
    if (pendingRegistration && pendingConfirmed) {
      return (
        <AuthStatusScreen
          icon={<CheckCircle2Icon className="size-6 text-emerald-500" />}
          tone="success"
          title="Email confirmed"
          description="Your account is active. Sign in to start chatting."
        >
          <Button type="button" className="w-full" onClick={backToSignIn}>
            Continue to sign in
          </Button>
        </AuthStatusScreen>
      )
    }

    if (pendingRegistration) {
      return <ConfirmEmailScreen pending={pendingRegistration} onBack={backToSignIn} />
    }

    if (loginNotice) {
      return (
        <AuthStatusScreen
          icon={
            loginNotice.kind === 'approval' ? (
              <ClockIcon className="size-6 text-primary" />
            ) : (
              <MailCheckIcon className="size-6 text-primary" />
            )
          }
          title={loginNotice.title}
          description={loginNotice.message}
        >
          <Button type="button" variant="ghost" onClick={() => setLoginNotice(null)}>
            Back to sign in
          </Button>
        </AuthStatusScreen>
      )
    }

    if (view === 'forgot') {
      return (
        <ForgotPasswordForm defaultEmail={forgotEmail} onBack={() => setView('credentials')} />
      )
    }

    return (
      <CredentialsForm
        defaultUsername={returnUsername}
        onPendingRegistration={(pending, password) => {
          persistPendingRegistration(pending)
          setReturnUsername(pending.username)
          setPendingRegistration(pending)
          setPendingConfirmed(false)
          setPendingPassword(password)
        }}
        onBlocked={setLoginNotice}
        onForgotPassword={(email) => {
          setForgotEmail(email)
          setView('forgot')
        }}
      />
    )
  }
}
