// Public API — mirrors the original spacetimedb.ts exports exactly.
// All 29 consumer files import from '../lib/spacetimedb' and resolve here automatically.

export type { SpacetimeDBClient } from './connection'
export { spacetimedbClient, onConnect, onDisconnect, onError, getCurrentSessionToken, tables } from './connection'
export { reducers } from './reducers'
export {
  initializeSpacetime,
  signOut,
  rotateIdentityForRegistration,
  loginWithPassword,
  resolveIdentityFromUsername,
} from './auth'
export {
  handleIncomingMessage,
  handleIncomingDirectMessage,
  handleIncomingFriendRequest,
  handleFriendAccepted,
} from './events'
