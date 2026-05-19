import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogInIcon, MailCheckIcon, PlugZapIcon, UserRoundPlusIcon } from 'lucide-react'
import { getCurrentSessionToken, loginWithPassword, rotateIdentityForRegistration } from '../lib/spacetimedb'
import { authServiceRegister, authServiceResendConfirmation } from '../lib/authService'
import { useSelfStore } from '../stores/selfStore'
import { useConnectionStore } from '../stores/connectionStore'
import { ConnectionTab } from '../features/settings/ConnectionTab'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

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
  // When set, registration succeeded but the account needs email confirmation.
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null)
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle')

  useEffect(() => {
    if (user) navigate('/app', { replace: true })
  }, [navigate, user])

  return (
    <section className="relative grid min-h-screen place-items-center bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/25),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/20),transparent)] p-4">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
        title="Connection settings"
        onClick={() => setConnectionSheetOpen(true)}
      >
        <PlugZapIcon className="size-4" />
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
            {pendingVerificationEmail
              ? 'One more step to activate your account.'
              : 'Sign in with your persisted account credentials.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingVerificationEmail ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
                <MailCheckIcon className="size-6 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Confirm your email</h3>
                <p className="text-sm text-muted-foreground">
                  We sent a confirmation link to{' '}
                  <span className="font-medium text-foreground">{pendingVerificationEmail}</span>. Open it
                  to activate your account, then sign in.
                </p>
              </div>
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
                      await authServiceResendConfirmation(pendingVerificationEmail)
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setPendingVerificationEmail(null)
                    setResendState('idle')
                    setError(null)
                    setMode('login')
                    setPassword('')
                    setConfirmPassword('')
                  }}
                >
                  Back to sign in
                </Button>
              </div>
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
                      // The SpacetimeDB `User` row is deliberately NOT created here —
                      // it is created on the first successful sign-in
                      // (loginWithPassword → ensureAuthenticatedUserRow), which only
                      // happens once the account is Active. That keeps an unconfirmed
                      // registration out of the app entirely.
                      await rotateIdentityForRegistration()
                      const spacetimeToken = getCurrentSessionToken()
                      const spacetimeIdentity = useConnectionStore.getState().identity
                      if (!spacetimeToken || !spacetimeIdentity) {
                        throw new Error('Could not obtain an active Spacetime session for registration.')
                      }

                      const result = await authServiceRegister({
                        username: normalizedUsername,
                        displayName: displayName.trim(),
                        password,
                        email: email.trim(),
                        spacetimeToken,
                        spacetimeIdentity,
                      })

                      // Account created but not yet usable — show the confirm-email
                      // screen and stop. No session, no SpacetimeDB user row.
                      if (result.status === 'pending_email_verification') {
                        setPendingVerificationEmail(result.email ?? email.trim())
                        setResendState('idle')
                        return
                      }

                      // Email confirmation disabled — the account is Active.
                      // Complete sign-in through the normal login path, which
                      // creates the SpacetimeDB user row and the session.
                      await loginWithPassword(normalizedUsername, password)
                      if (!useSelfStore.getState().user) {
                        throw new Error('Registration completed but sign-in did not. Please try logging in.')
                      }
                    } else {
                      await loginWithPassword(normalizedUsername, password)
                      if (!useSelfStore.getState().user) {
                        throw new Error('Login did not complete. Please retry and check core-api + spacetime processes.')
                      }
                    }
                  } catch (e) {
                    const message = e instanceof Error ? e.message : 'Authentication failed.'
                    setError(message)
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
