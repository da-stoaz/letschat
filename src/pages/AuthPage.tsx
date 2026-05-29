import { useEffect, useRef, useState } from 'react'

function readPersistedPendingRegistration(): PendingRegistration | null {
  const raw = localStorage.getItem(PENDING_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingRegistration
  } catch {
    localStorage.removeItem(PENDING_KEY)
    return null
  }
}
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2Icon,
  ClockIcon,
  LogInIcon,
  MailCheckIcon,
  PlugZapIcon,
  UserRoundPlusIcon,
} from 'lucide-react'
import { getCurrentSessionToken, loginWithPassword, rotateIdentityForRegistration } from '../lib/spacetimedb'
import {
  authServiceRegister,
  authServiceRegistrationStatus,
  authServiceResendConfirmation,
  type RegisterResult,
} from '../lib/authService'
import { useSelfStore } from '../stores/selfStore'
import { useConnectionStore } from '../stores/connectionStore'
import { ConnectionTab } from '../features/settings/ConnectionTab'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

// The pending registration is persisted so the "confirm your email" screen
// survives an app reload, and carries enough to poll for confirmation.
const PENDING_KEY = 'letschat.pending_registration'

type PendingRegistration = { email: string; username: string; spacetimeIdentity: string }
type LoginNotice = { kind: 'email' | 'approval'; title: string; message: string }

export function AuthPage() {
  const navigate = useNavigate()
  const user = useSelfStore((s) => s.user)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [connectionSheetOpen, setConnectionSheetOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Registration done, awaiting email confirmation (polled in the background).
  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistration | null>(readPersistedPendingRegistration)
  const [pendingConfirmed, setPendingConfirmed] = useState(false)
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle')
  // A sign-in attempt was blocked for a known, non-error reason.
  const [loginNotice, setLoginNotice] = useState<LoginNotice | null>(null)
  // Guards the status poll against overlapping runs (a poll that finishes sign-in
  // takes a few seconds; the interval must not start a second one meanwhile).
  const pollBusyRef = useRef(false)

  useEffect(() => {
    if (user) navigate('/app', { replace: true })
  }, [navigate, user])

  // While waiting on email confirmation, poll the account status and advance
  // automatically once it is confirmed (and approved, if approval is required).
  useEffect(() => {
    if (!pendingRegistration || pendingConfirmed) return
    let cancelled = false

    const poll = async () => {
      if (pollBusyRef.current) return
      pollBusyRef.current = true
      try {
        await runPoll()
      } finally {
        pollBusyRef.current = false
      }
    }

    const runPoll = async () => {
      let status: string
      try {
        status = await authServiceRegistrationStatus(
          pendingRegistration.username,
          pendingRegistration.spacetimeIdentity,
        )
      } catch {
        return // transient — keep polling
      }
      if (cancelled) return

      if (status === 'active') {
        // Email confirmed, no approval needed. Finish sign-in if we still hold
        // the password (same session); otherwise show the "confirmed" screen.
        if (password) {
          try {
            await loginWithPassword(pendingRegistration.username, password)
            localStorage.removeItem(PENDING_KEY)
            if (!cancelled) setPendingRegistration(null)
            return
          } catch {
            // fall through to the manual confirmed screen
          }
        }
        if (!cancelled) setPendingConfirmed(true)
      } else if (status === 'email_verified') {
        localStorage.removeItem(PENDING_KEY)
        if (cancelled) return
        setPendingRegistration(null)
        setLoginNotice({
          kind: 'approval',
          title: 'Awaiting approval',
          message:
            'Your email is confirmed. An administrator needs to approve your account ' +
            'before you can sign in — you will be emailed once it is approved.',
        })
      } else if (status === 'rejected' || status === 'disabled') {
        localStorage.removeItem(PENDING_KEY)
        if (cancelled) return
        setPendingRegistration(null)
        setLoginNotice({
          kind: 'approval',
          title: status === 'rejected' ? 'Account not approved' : 'Account disabled',
          message:
            status === 'rejected'
              ? 'This account was not approved by an administrator.'
              : 'This account has been disabled by an administrator.',
        })
      }
      // 'registered' / 'unknown' → keep waiting
    }

    const interval = setInterval(poll, 4000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [pendingRegistration, pendingConfirmed, password])

  function leavePending() {
    localStorage.removeItem(PENDING_KEY)
    if (pendingRegistration) setUsername(pendingRegistration.username)
    setPendingRegistration(null)
    setPendingConfirmed(false)
    setResendState('idle')
    setError(null)
    setMode('login')
    setPassword('')
    setConfirmPassword('')
  }

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
          <CardDescription>
            {pendingRegistration
              ? pendingConfirmed
                ? 'Your account is ready.'
                : 'One more step to activate your account.'
              : loginNotice
                ? 'This account is not ready to sign in yet.'
                : 'Sign in with your persisted account credentials.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingRegistration && pendingConfirmed ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2Icon className="size-6 text-emerald-500" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Email confirmed</h3>
                <p className="text-sm text-muted-foreground">
                  Your account is active. Sign in to start chatting.
                </p>
              </div>
              <Button type="button" className="w-full" onClick={leavePending}>
                Continue to sign in
              </Button>
            </div>
          ) : pendingRegistration ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
                <MailCheckIcon className="size-6 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Confirm your email</h3>
                <p className="text-sm text-muted-foreground">
                  We sent a confirmation link to{' '}
                  <span className="font-medium text-foreground">{pendingRegistration.email}</span>. Open
                  it — this screen updates automatically once you do.
                </p>
              </div>
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
                      await authServiceResendConfirmation(pendingRegistration.email)
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
                <Button type="button" variant="ghost" onClick={leavePending}>
                  Back to sign in
                </Button>
              </div>
            </div>
          ) : loginNotice ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
                {loginNotice.kind === 'approval' ? (
                  <ClockIcon className="size-6 text-primary" />
                ) : (
                  <MailCheckIcon className="size-6 text-primary" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">{loginNotice.title}</h3>
                <p className="text-sm text-muted-foreground">{loginNotice.message}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLoginNotice(null)
                  setError(null)
                }}
              >
                Back to sign in
              </Button>
            </div>
          ) : (
            <>
              <Tabs
                value={mode}
                onValueChange={(value) => setMode(value as 'login' | 'register')}
                className="mb-4"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">Log In</TabsTrigger>
                  <TabsTrigger value="register">Register</TabsTrigger>
                </TabsList>
              </Tabs>
              <form
                className="space-y-4"
                onSubmit={async (event) => {
                  event.preventDefault()
                  if (submitting) return
                  setError(null)
                  setSubmitting(true)
                  try {
                    const normalizedUsername = username.trim().toLowerCase()
                    if (password.length < 8) {
                      throw new Error('Password must be at least 8 characters.')
                    }

                    if (mode === 'register') {
                      if (displayName.trim().length < 1) {
                        throw new Error('Display name is required.')
                      }
                      if (email.trim().length < 1) {
                        throw new Error('Email is required.')
                      }
                      if (password !== confirmPassword) {
                        throw new Error('Passwords do not match.')
                      }

                      // Establish a fresh SpacetimeDB identity to bind the account to.
                      // The SpacetimeDB `User` row is created on first sign-in, not here.
                      await rotateIdentityForRegistration()
                      const spacetimeToken = getCurrentSessionToken()
                      const spacetimeIdentity = useConnectionStore.getState().identity
                      if (!spacetimeToken || !spacetimeIdentity) {
                        throw new Error('Could not obtain an active Spacetime session for registration.')
                      }

                      const result: RegisterResult = await authServiceRegister({
                        username: normalizedUsername,
                        displayName: displayName.trim(),
                        password,
                        email: email.trim(),
                        spacetimeToken,
                        spacetimeIdentity,
                      })

                      // Account created but not yet usable — show (and persist) the
                      // confirm-email screen; the poll above advances it.
                      if (result.status === 'pending_email_verification') {
                        const pending: PendingRegistration = {
                          email: result.email ?? email.trim(),
                          username: normalizedUsername,
                          spacetimeIdentity,
                        }
                        localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
                        setPendingRegistration(pending)
                        setPendingConfirmed(false)
                        setResendState('idle')
                        return
                      }

                      // Email confirmation disabled — finish through the login path.
                      await loginWithPassword(normalizedUsername, password)
                      if (!useSelfStore.getState().user) {
                        throw new Error('Registration completed but sign-in did not. Please try logging in.')
                      }
                      localStorage.removeItem(PENDING_KEY)
                    } else {
                      await loginWithPassword(normalizedUsername, password)
                      if (!useSelfStore.getState().user) {
                        throw new Error('Login did not complete. Please retry and check core-api + spacetime processes.')
                      }
                      localStorage.removeItem(PENDING_KEY)
                    }
                  } catch (e) {
                    const message = e instanceof Error ? e.message : 'Authentication failed.'
                    // Blocked-account reasons get a dedicated screen, not a red error.
                    if (/confirm your email/i.test(message)) {
                      setLoginNotice({
                        kind: 'email',
                        title: 'Confirm your email',
                        message:
                          'This account exists but its email address has not been confirmed. ' +
                          'Open the confirmation link in your inbox, then sign in.',
                      })
                    } else if (/awaiting administrator approval/i.test(message)) {
                      setLoginNotice({
                        kind: 'approval',
                        title: 'Awaiting approval',
                        message:
                          'Your email is confirmed. An administrator needs to approve your account ' +
                          'before you can sign in — you will be emailed once it is approved.',
                      })
                    } else {
                      setError(message)
                    }
                  } finally {
                    setSubmitting(false)
                  }
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="auth-username">Username</Label>
                  <Input
                    id="auth-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    minLength={2}
                    maxLength={32}
                    required
                    placeholder="username"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    autoComplete="username"
                  />
                </div>
                {mode === 'register' ? (
                  <div className="space-y-2">
                    <Label htmlFor="auth-display-name">Display Name</Label>
                    <Input
                      id="auth-display-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                      placeholder="Display Name"
                    />
                  </div>
                ) : null}
                {mode === 'register' ? (
                  <div className="space-y-2">
                    <Label htmlFor="auth-email">Email</Label>
                    <Input
                      id="auth-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      autoComplete="email"
                    />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="auth-password">Password</Label>
                  <Input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                    placeholder="Password"
                  />
                </div>
                {mode === 'register' ? (
                  <div className="space-y-2">
                    <Label htmlFor="auth-password-confirm">Confirm Password</Label>
                    <Input
                      id="auth-password-confirm"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      minLength={8}
                      required
                      placeholder="Confirm password"
                    />
                  </div>
                ) : null}
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <div className="flex items-center justify-end gap-2">
                  <Button type="submit" className="min-w-36" disabled={submitting}>
                    {mode === 'register' ? <UserRoundPlusIcon className="size-4" /> : <LogInIcon className="size-4" />}
                    {submitting ? 'Please wait…' : mode === 'register' ? 'Create Account' : 'Log In'}
                  </Button>
                </div>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
