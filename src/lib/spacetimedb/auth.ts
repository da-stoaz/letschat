import { connect, disconnect, setStoredToken, clearStoredToken, spacetimedbClient } from './connection'
import { reducers } from './reducers'
import { syncUsers } from './sync'
import { sameIdentity, normalizeUsername, toIdentityString } from './mappers'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSelfStore } from '../../stores/selfStore'
import { authServiceChangePassword, authServiceLogin, clearStoredAuthSessionToken } from '../authService'
import { clearSignedDownloadUrlCache } from '../uploads'
import { clearBadgeCount } from '../notifications'
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

  const existingUsernameOwner = Array.from(conn.db.my_visible_users.iter()).find(
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

/**
 * Changes the password, then signs in again with it.
 *
 * The server revokes every token issued under the old password — that is the
 * point — and this connection is still holding one of them. The module reads
 * the token off the connection itself, so without a fresh sign-in the user's
 * own reducers start failing the moment they change their password.
 *
 * Deliberately delegates to {@link loginWithPassword} rather than adopting a
 * token returned by the change itself. That keeps every credential this client
 * persists coming through one path — the one that also verifies the identity
 * SpacetimeDB connected as actually matches the account core-api authenticated,
 * and that ensures the module `User` row exists. A second, parallel adoption
 * path would have to repeat both checks or quietly skip them.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const username = useSelfStore.getState().user?.username
  if (!username) throw new Error('No signed-in account to change the password for.')

  await authServiceChangePassword({ currentPassword, newPassword })

  // The old session is dead from here on. If this throws, the password HAS
  // changed — surfacing that is better than pretending otherwise, and the user
  // can sign in normally.
  await loginWithPassword(username, newPassword)
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
  const normalized = normalizeUsername(username)
  if (!normalized) throw new Error('Username is required.')
  if (password.length < 8) throw new Error('Password must be at least 8 characters.')

  // core-api mints the SpacetimeDB token (signed by the issuer it controls);
  // SpacetimeDB derives the identity from it. Connect with that token — no
  // anonymous pre-connect, no identity-copy staleness to reconcile.
  const auth = await authServiceLogin({ username: normalized, password })

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

  // The identity we connected as must be the one core-api just authenticated.
  // They diverge when SpacetimeDB rejects the minted token and hands back an
  // anonymous identity instead — which onConnect then persists, so every later
  // connect reuses the wrong identity. Left unchecked this surfaces much later
  // and far more confusingly, as "username already exists" from register_user.
  // Drop the bad token and say what actually went wrong.
  if (!sameIdentity(connectedIdentity, auth.spacetimeIdentity)) {
    disconnect()
    clearStoredToken()
    throw new Error(
      'Login failed: SpacetimeDB did not accept this account\'s token and connected ' +
        'anonymously instead. The stored token has been cleared — try again. If it keeps ' +
        'happening, the server\'s SPACETIME_OIDC_PRIVATE_KEY is probably unset or changed, ' +
        'so tokens it signs no longer verify.',
    )
  }

  await ensureAuthenticatedUserRow(normalized, auth.displayName)
}
