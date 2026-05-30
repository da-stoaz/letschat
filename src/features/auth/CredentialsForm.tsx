import { useState } from 'react'
import { LogInIcon, UserRoundPlusIcon } from 'lucide-react'
import {
  getCurrentSessionToken,
  loginWithPassword,
  rotateIdentityForRegistration,
} from '../../lib/spacetimedb'
import { authServiceRegister, type RegisterResult } from '../../lib/authService'
import { useSelfStore } from '../../stores/selfStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { clearPendingRegistration, type LoginNotice, type PendingRegistration } from './state'

/**
 * The sign-in / register surface — the two first-want actions, switched with a
 * tab bar. Owns all of its own field state and error, so other auth views never
 * inherit a sign-in error (and vice versa).
 *
 * On outcomes it can't resolve itself it calls up:
 *  - `onPendingRegistration` — a register that needs email confirmation
 *  - `onBlocked` — a sign-in blocked for a known reason (unconfirmed / approval)
 *  - `onForgotPassword` — the user wants the password-reset view
 *
 * A successful sign-in needs no callback: it populates the self store, and the
 * parent's redirect effect takes over.
 */
export function CredentialsForm({
  defaultUsername = '',
  onPendingRegistration,
  onBlocked,
  onForgotPassword,
}: {
  defaultUsername?: string
  onPendingRegistration: (pending: PendingRegistration, password: string) => void
  onBlocked: (notice: LoginNotice) => void
  onForgotPassword: (email: string) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState(defaultUsername)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value as 'login' | 'register')
          setError(null)
        }}
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

              // Account created but not yet usable — hand the confirm-email
              // screen (and the password, for auto sign-in) up to the parent.
              if (result.status === 'pending_email_verification') {
                onPendingRegistration(
                  {
                    email: result.email ?? email.trim(),
                    username: normalizedUsername,
                    spacetimeIdentity,
                  },
                  password,
                )
                return
              }

              // Email confirmation disabled — finish through the login path.
              await loginWithPassword(normalizedUsername, password)
              if (!useSelfStore.getState().user) {
                throw new Error('Registration completed but sign-in did not. Please try logging in.')
              }
              clearPendingRegistration()
            } else {
              await loginWithPassword(normalizedUsername, password)
              if (!useSelfStore.getState().user) {
                throw new Error('Login did not complete. Please retry and check core-api + spacetime processes.')
              }
              clearPendingRegistration()
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Authentication failed.'
            // Blocked-account reasons get a dedicated screen, not a red error.
            if (/confirm your email/i.test(message)) {
              onBlocked({
                kind: 'email',
                title: 'Confirm your email',
                message:
                  'This account exists but its email address has not been confirmed. ' +
                  'Open the confirmation link in your inbox, then sign in.',
              })
            } else if (/awaiting administrator approval/i.test(message)) {
              onBlocked({
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
          <div className="flex items-center justify-between">
            <Label htmlFor="auth-password">Password</Label>
            {mode === 'login' ? (
              <button
                type="button"
                onClick={() => onForgotPassword(email)}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Forgot password?
              </button>
            ) : null}
          </div>
          <Input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            placeholder="Password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
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
              autoComplete="new-password"
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
  )
}
