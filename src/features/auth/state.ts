// Shared auth-screen types and the persisted "pending registration" slot.
//
// A registration that still needs email confirmation is persisted so the
// "confirm your email" screen survives an app reload, carrying just enough to
// keep polling for confirmation.

export const PENDING_KEY = 'letschat.pending_registration'

export type PendingRegistration = {
  email: string
  username: string
  spacetimeIdentity: string
}

/** A sign-in attempt blocked for a known, non-error reason (its own screen). */
export type LoginNotice = {
  kind: 'email' | 'approval'
  title: string
  message: string
}

export function readPendingRegistration(): PendingRegistration | null {
  const raw = localStorage.getItem(PENDING_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingRegistration
  } catch {
    localStorage.removeItem(PENDING_KEY)
    return null
  }
}

export function persistPendingRegistration(pending: PendingRegistration): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
}

export function clearPendingRegistration(): void {
  localStorage.removeItem(PENDING_KEY)
}
