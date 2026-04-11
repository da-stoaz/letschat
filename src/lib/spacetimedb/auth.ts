import { connect, disconnect, getCurrentSessionToken, setStoredToken, clearStoredToken, spacetimedbClient } from './connection'
import { reducers } from './reducers'
import { syncUsers } from './sync'
import { sameIdentity, normalizeUsername, toIdentityString } from './mappers'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSelfStore } from '../../stores/selfStore'
import { authServiceLogin, authServiceRefreshSpacetimeToken, clearStoredAuthSessionToken } from '../authService'
import { clearSignedDownloadUrlCache } from '../uploads'
import { clearBadgeCount } from '../notifications'
import type { Identity } from '../../types/domain'
import type { DbConnection } from '../../generated'

export async function initializeSpacetime(): Promise<void> {
  await connect()
}

export async function signOut(): Promise<void> {
  const conn = spacetimedbClient.connection
  if (conn) {
    const offlineReducer = conn.reducers?.setPresenceOffline
    if (typeof offlineReducer === 'function') {
      try {
        await offlineReducer({})
      } catch {
        // best-effort: keep sign-out flow resilient even if reducer call fails.
      }
    }
  }
  disconnect()
  clearStoredToken()
  clearStoredAuthSessionToken()
  clearSignedDownloadUrlCache()
  await clearBadgeCount()
}

export async function rotateIdentityForRegistration(): Promise<void> {
  // Registration always creates a user for the current anonymous identity.
  // To avoid sticky stale identities, force a fresh tokenless reconnect.
  disconnect()
  clearStoredToken()
  await connect()
}

async function ensureAuthenticatedUserRow(normalizedUsername: string, displayName: string): Promise<void> {
  if (!spacetimedbClient.connection) {
    await connect()
  }
  const conn = spacetimedbClient.connection as DbConnection
  syncUsers(conn)
  if (useSelfStore.getState().user) return

  const currentIdentity = useConnectionStore.getState().identity
  if (!currentIdentity) {
    throw new Error('Login succeeded but no Spacetime identity is active.')
  }

  const existingUsernameOwner = Array.from(conn.db.user.iter()).find(
    (row) => row.username.toLowerCase() === normalizedUsername,
  )
  if (existingUsernameOwner) {
    const ownerIdentity = toIdentityString(existingUsernameOwner.identity)
    if (!sameIdentity(ownerIdentity, currentIdentity)) {
      throw new Error(
        'This username is linked to a different Spacetime identity. Re-link from a currently signed-in session.',
      )
    }
  }

  try {
    await reducers.registerUser(normalizedUsername, displayName)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('user already registered for this identity')) {
      throw error
    }
  }

  syncUsers(conn)
  if (!useSelfStore.getState().user) {
    throw new Error('Login succeeded but user profile is not available for this identity.')
  }
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
  const normalized = normalizeUsername(username)
  if (!normalized) throw new Error('Username is required.')
  if (password.length < 8) throw new Error('Password must be at least 8 characters.')

  const auth = await authServiceLogin({
    username: normalized,
    password,
  })

  disconnect()
  setStoredToken(auth.spacetimeToken)
  try {
    await connect()
  } catch (error) {
    clearStoredToken()
    throw error
  }

  const connectedIdentity = useConnectionStore.getState().identity
  if (!connectedIdentity) {
    disconnect()
    clearStoredToken()
    throw new Error('Login failed: authenticated session has no active identity.')
  }

  if (!sameIdentity(connectedIdentity, auth.spacetimeIdentity)) {
    disconnect()
    clearStoredToken()
    throw new Error(
      'Login token is stale for this account. Sign in from a linked session and relink this device in Settings.',
    )
  }

  // Update the auth service with the fresh token SpacetimeDB issued during this connection,
  // so the next login won't hit a stale token.
  const freshToken = getCurrentSessionToken()
  if (freshToken) {
    authServiceRefreshSpacetimeToken({ sessionToken: auth.sessionToken, spacetimeToken: freshToken })
      .catch(() => undefined) // best-effort, never fail login over this
  }

  await ensureAuthenticatedUserRow(normalized, auth.displayName)
}

export async function resolveIdentityFromUsername(username: string): Promise<Identity | null> {
  if (!spacetimedbClient.connection) {
    await connect()
  }

  const normalized = username.trim().toLowerCase()
  const user = Array.from((spacetimedbClient.connection as DbConnection).db.user.iter()).find(
    (row) => row.username.toLowerCase() === normalized,
  )
  return user ? toIdentityString(user.identity) : null
}
