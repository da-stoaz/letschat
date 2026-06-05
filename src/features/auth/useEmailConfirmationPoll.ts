import { useEffect, useRef } from 'react'
import { loginWithPassword } from '../../lib/spacetimedb'
import { authServiceRegistrationStatus } from '../../lib/authService'
import { clearPendingRegistration, type LoginNotice, type PendingRegistration } from './state'

type PollArgs = {
  pending: PendingRegistration | null
  confirmed: boolean
  /**
   * Password from the just-completed registration, if still held in memory.
   * Lets the poll finish sign-in automatically once the email is confirmed.
   */
  password: string | null
  /** Email confirmed, but no password in hand — show the manual "ready" screen. */
  onConfirmedManual: () => void
  /** Email confirmed and the poll signed the user in. */
  onSignedIn: () => void
  /** Account moved to a state that blocks sign-in (approval / rejected / disabled). */
  onBlocked: (notice: LoginNotice) => void
}

/**
 * While a registration awaits email confirmation, polls the account status and
 * advances the screen automatically once it resolves. Callbacks are kept in a
 * ref so the polling interval isn't torn down and recreated on every render.
 */
export function useEmailConfirmationPoll({
  pending,
  confirmed,
  password,
  onConfirmedManual,
  onSignedIn,
  onBlocked,
}: PollArgs): void {
  const handlers = useRef({ onConfirmedManual, onSignedIn, onBlocked })
  useEffect(() => {
    handlers.current = { onConfirmedManual, onSignedIn, onBlocked }
  })

  // Guards against overlapping runs: a poll that finishes sign-in takes a few
  // seconds, and the interval must not kick off a second one meanwhile.
  const busyRef = useRef(false)

  useEffect(() => {
    if (!pending || confirmed) return
    let cancelled = false

    const runPoll = async () => {
      let status: string
      try {
        status = await authServiceRegistrationStatus(pending.username, pending.spacetimeIdentity)
      } catch {
        return // transient — keep polling
      }
      if (cancelled) return

      if (status === 'active') {
        if (password) {
          try {
            await loginWithPassword(pending.username, password)
            clearPendingRegistration()
            if (!cancelled) handlers.current.onSignedIn()
            return
          } catch {
            // fall through to the manual "ready to sign in" screen
          }
        }
        if (!cancelled) handlers.current.onConfirmedManual()
      } else if (status === 'email_verified') {
        clearPendingRegistration()
        if (cancelled) return
        handlers.current.onBlocked({
          kind: 'approval',
          title: 'Awaiting approval',
          message:
            'Your email is confirmed. An administrator needs to approve your account ' +
            'before you can sign in — you will be emailed once it is approved.',
        })
      } else if (status === 'rejected' || status === 'disabled') {
        clearPendingRegistration()
        if (cancelled) return
        handlers.current.onBlocked({
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

    const poll = async () => {
      if (busyRef.current) return
      busyRef.current = true
      try {
        await runPoll()
      } finally {
        busyRef.current = false
      }
    }

    const interval = setInterval(poll, 4000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [pending, confirmed, password])
}
