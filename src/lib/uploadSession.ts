import { authServiceRenewSession, type AuthFrameworkToken, getStoredAuthSessionToken } from './authService'
import { useConnectionStore } from '../stores/connectionStore'

const TOKEN_EXPIRY_BUFFER_MS = 30_000
const SPACETIMEDB_TOKEN_KEY = 'spacetimedb.auth_token'

let renewSessionPromise: Promise<AuthFrameworkToken> | null = null

function isSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('invalid or expired session token') || message.includes('invalid auth session')
}

function isTokenExpiredSoon(token: AuthFrameworkToken, bufferMs = TOKEN_EXPIRY_BUFFER_MS): boolean {
  const expiresAtMs = Date.parse(token.expires_at)
  if (!Number.isFinite(expiresAtMs)) return true
  return Date.now() >= expiresAtMs - bufferMs
}

function getStoredSpacetimeToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(SPACETIMEDB_TOKEN_KEY)
}

export async function renewAuthSession(): Promise<AuthFrameworkToken> {
  if (renewSessionPromise) return renewSessionPromise

  renewSessionPromise = (async () => {
    const spacetimeToken = getStoredSpacetimeToken()
    const spacetimeIdentity = useConnectionStore.getState().identity
    if (!spacetimeToken || !spacetimeIdentity) {
      throw new Error('Your auth session expired. Please sign in again.')
    }
    return authServiceRenewSession({
      spacetimeToken,
      spacetimeIdentity,
    })
  })()

  try {
    return await renewSessionPromise
  } finally {
    renewSessionPromise = null
  }
}

export async function ensureActiveSessionToken(): Promise<AuthFrameworkToken> {
  const currentToken = getStoredAuthSessionToken()
  if (currentToken && !isTokenExpiredSoon(currentToken)) {
    return currentToken
  }
  return renewAuthSession()
}

export async function withSessionTokenRetry<T>(fn: (sessionToken: AuthFrameworkToken) => Promise<T>): Promise<T> {
  const initialToken = await ensureActiveSessionToken()
  try {
    return await fn(initialToken)
  } catch (error) {
    if (!isSessionError(error)) throw error
  }

  const refreshedToken = await renewAuthSession()
  return fn(refreshedToken)
}
