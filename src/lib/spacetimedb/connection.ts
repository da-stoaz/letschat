import { DbConnection, tables } from '../../generated'
import { watchLiveTables } from './events'
import { syncAll, resetClientState } from './sync'
import { notify } from '../notifications'
import { useConnectionStore, type ConnectionStatus } from '../../stores/connectionStore'
import { useServerConfigStore } from '../../stores/serverConfigStore'

export type SpacetimeDBClient = {
  connection: DbConnection | null
  connect: () => Promise<void>
  disconnect: () => void
  call: <TArgs extends Record<string, unknown>>(reducer: string, args?: TArgs) => Promise<void>
}

// ─── Module state ─────────────────────────────────────────────────────────────

let connection: DbConnection | null = null
let subscriptionHandle: { unsubscribe: () => void } | null = null
let connectPromise: Promise<void> | null = null
let liveEventsEnabled = false

// ─── Keepalive + reconnect ─────────────────────────────────────────────────
// The SpacetimeDB SDK has no built-in heartbeat or auto-reconnect (it only
// flips `isActive` on close). The server closes idle sockets after its
// `idle_timeout` (30s by default) if it sees no client data, and proxies like
// Cloudflare cull idle WebSockets too. So we send a cheap reducer round-trip on
// an interval to keep the socket warm, and reconnect with backoff when it drops.
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let heartbeatInFlight = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
// Set while a caller-initiated disconnect() is in effect, to suppress the
// automatic reconnect that would otherwise fire on the resulting close.
let intentionalDisconnect = false

// Comfortably under the server's 30s default `idle_timeout` and a typical ~100s
// proxy idle cull, with margin for a slow round-trip.
const HEARTBEAT_INTERVAL_MS = 25_000
const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000

// ─── Internal helpers ─────────────────────────────────────────────────────────

function setStatus(status: ConnectionStatus): void {
  useConnectionStore.getState().setStatus(status)
}

// Tear down the active connection's subscription and handle, then drop it.
// `closeSocket` also disconnects the underlying WebSocket — skip it when we're
// already inside the SDK's onDisconnect, where the socket is closed and
// re-closing it could re-enter the callback.
function teardownConnection(closeSocket = false): void {
  subscriptionHandle?.unsubscribe()
  subscriptionHandle = null
  liveEventsEnabled = false
  if (closeSocket) connection?.disconnect()
  connection = null
}

// ─── Token storage ────────────────────────────────────────────────────────────

const SPACETIMEDB_TOKEN_KEY = 'spacetimedb.auth_token'

export function getStoredToken(): string | undefined {
  const token = localStorage.getItem(SPACETIMEDB_TOKEN_KEY)
  return token ?? undefined
}

export function setStoredToken(token: string): void {
  localStorage.setItem(SPACETIMEDB_TOKEN_KEY, token)
}

export function clearStoredToken(): void {
  localStorage.removeItem(SPACETIMEDB_TOKEN_KEY)
}

export function getCurrentSessionToken(): string | null {
  return getStoredToken() ?? null
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function getConnectionErrorDetails(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim()
  }
  if (error && typeof error === 'object') {
    const maybeEvent = error as { type?: unknown; message?: unknown }
    if (typeof maybeEvent.message === 'string' && maybeEvent.message.trim().length > 0) {
      return maybeEvent.message.trim()
    }
    if (typeof maybeEvent.type === 'string' && maybeEvent.type.trim().length > 0) {
      return `${maybeEvent.type.trim()} event`
    }
  }
  const fallback = String(error)
  return fallback === '[object Event]' ? 'network event' : fallback
}

// ─── URI resolution ───────────────────────────────────────────────────────────

function canonicalizeUriCandidate(raw: string): string {
  try {
    const parsed = new URL(raw.trim())
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      return `${parsed.protocol}//${parsed.host}`
    }
    return parsed.toString()
  } catch {
    return raw.trim()
  }
}

function buildSpacetimeUriCandidates(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return ['ws://127.0.0.1:4300']

  const orderedCandidates: string[] = []
  const seenCandidates = new Set<string>()
  const pushCandidate = (candidate: string): void => {
    const canonical = canonicalizeUriCandidate(candidate)
    if (!canonical) return
    if (seenCandidates.has(canonical)) return
    seenCandidates.add(canonical)
    orderedCandidates.push(canonical)
  }

  pushCandidate(trimmed)

  try {
    const parsed = new URL(trimmed)
    const hostname = parsed.hostname.toLowerCase()
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    if (!isLoopback) return orderedCandidates

    const loopbackHosts = ['127.0.0.1', 'localhost', '::1']
    for (const host of loopbackHosts) {
      try {
        const next = new URL(parsed.toString())
        next.hostname = host
        pushCandidate(next.toString())
      } catch {
        // Ignore malformed host rewrites and continue with remaining candidates.
      }
    }
  } catch {
    // Keep the original raw URI as-is when URL parsing fails.
  }

  return orderedCandidates
}

// ─── Connection lifecycle ─────────────────────────────────────────────────────

const SPACETIMEDB_CONNECT_TIMEOUT_MS = 5_000

async function connectWithUri(uri: string, database: string, reportErrors: boolean): Promise<void> {
  let appliedOnce = false
  // True once this connection has fully applied its initial sync. Distinguishes
  // an established connection that later drops (→ auto-reconnect) from an
  // initial-handshake failure (→ let connect()'s candidate loop handle it).
  let establishedThisConnection = false
  let resolveApplied: (() => void) | null = null
  let rejectApplied: ((error: unknown) => void) | null = null
  const firstSyncApplied = new Promise<void>((resolve, reject) => {
    resolveApplied = resolve
    rejectApplied = reject
  })
  const rejectIfPending = (error: unknown): void => {
    if (appliedOnce) return
    appliedOnce = true
    rejectApplied?.(error)
  }
  const connectTimeout = setTimeout(() => {
    rejectIfPending(
      new Error(
        `Timed out connecting to SpacetimeDB at ${uri}. Ensure \`spacetime start\` is running and the module is published.`,
      ),
    )
  }, SPACETIMEDB_CONNECT_TIMEOUT_MS)

  try {
    const builder = DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .withLightMode(false)
      // Disable WebSocket message compression. The SDK's default ("gzip")
      // decompresses by async-iterating a DecompressionStream, which Tauri's
      // WKWebView runtime does not support — every incoming message throws
      // `undefined is not a function (near '...chunk of decompressedStream...')`
      // and the connection never completes. "none" makes the server send
      // uncompressed frames, which the SDK returns directly.
      .withCompression('none')
      .withToken(getStoredToken())
      .onConnect((_conn, identity, token) => {
        const identityString =
          identity && typeof identity === 'object' && 'toHexString' in identity ?
            (identity as { toHexString(): string }).toHexString()
          : String(identity)
        setStatus('connected')
        useConnectionStore.getState().setIdentity(identityString as import('../../types/domain').Identity)
        setStoredToken(token)
      })
      .onDisconnect(() => {
        setStatus('disconnected')
        // Drop the stale handle so the next `connect()`/`call()` rebuilds the
        // socket instead of firing reducers into a closed WebSocket (which
        // never ack and hang forever). A WS culled mid-idle — e.g. by a proxy's
        // ~100s idle timeout — leaves the SDK object non-null but inactive, so
        // guarding on null alone is not enough.
        if (connection === nextConnection) {
          teardownConnection()
        }
        stopHeartbeat()
        // Auto-reconnect only an established connection that dropped — not an
        // initial handshake failure, which connect()'s own error path owns.
        if (establishedThisConnection && !intentionalDisconnect) {
          scheduleReconnect()
        }
        rejectIfPending(new Error('Disconnected before initial data sync completed.'))
      })
      .onConnectError((_ctx, error) => {
        void _ctx
        const details = getConnectionErrorDetails(error)
        const wrapped = new Error(`SpacetimeDB connection failed at ${uri} (${details}).`)
        rejectIfPending(wrapped)
        if (reportErrors) {
          void onError(wrapped)
        }
      })

    const nextConnection = builder.build()
    connection = nextConnection
    watchLiveTables(nextConnection, () => liveEventsEnabled)

    subscriptionHandle = nextConnection
      .subscriptionBuilder()
      .onApplied(() => {
        syncAll(nextConnection)
        liveEventsEnabled = true
        establishedThisConnection = true
        if (appliedOnce) return
        appliedOnce = true
        clearTimeout(connectTimeout)
        resolveApplied?.()
      })
      .onError((_ctx) => {
        void _ctx
        if (reportErrors) {
          void onError(new Error('Subscription failed'))
        }
        clearTimeout(connectTimeout)
        rejectIfPending(new Error('Subscription failed'))
      })
      .subscribe([
        tables.my_visible_users,
        tables.my_servers,
        tables.my_server_members,
        tables.my_channels,
        tables.my_channel_messages,
        tables.my_voice_participants,
        tables.my_friends,
        tables.my_blocks,
        tables.my_direct_messages,
        tables.my_dm_voice_participants,
        tables.my_presence_states,
        tables.my_typing_states,
        tables.my_read_states,
        tables.my_invites,
        tables.my_join_requests,
        tables.my_dm_server_invites,
        tables.my_bans,
      ])

    await firstSyncApplied
  } finally {
    clearTimeout(connectTimeout)
    if (!appliedOnce) {
      teardownConnection(true)
    }
  }
}

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    void runHeartbeat()
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  heartbeatInFlight = false
}

async function runHeartbeat(): Promise<void> {
  // Reconnect is owned by the onDisconnect → scheduleReconnect path; if we're
  // not live, do nothing and let that path bring us back.
  if (heartbeatInFlight || !connection?.isActive) return
  heartbeatInFlight = true
  try {
    // touch_presence is a single-row upsert: it keeps the WebSocket warm (so the
    // server's idle_timeout and the proxy's idle cull never fire) and doubles as
    // a liveness probe — if it can't round-trip within call()'s timeout, the
    // socket is a zombie.
    await call('touchPresence')
  } catch {
    // Zombie socket: force a clean teardown so onDisconnect nulls the handle and
    // schedules a backoff reconnect.
    connection?.disconnect()
  } finally {
    heartbeatInFlight = false
  }
}

function scheduleReconnect(): void {
  if (intentionalDisconnect || reconnectTimer) return
  // Exponential backoff with jitter: half fixed, half random, capped.
  const ceiling = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts)
  const delay = ceiling / 2 + Math.random() * (ceiling / 2)
  reconnectAttempts += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connect().catch(() => {
      scheduleReconnect()
    })
  }, delay)
}

export async function connect(): Promise<void> {
  intentionalDisconnect = false
  if (connection?.isActive) return
  if (connectPromise) return connectPromise

  const serverConfig = useServerConfigStore.getState().config
  if (!serverConfig) {
    throw new Error('Server not configured. Please complete setup first.')
  }
  const { spacetimedbUri: SPACETIMEDB_URI, spacetimedbDatabase: SPACETIMEDB_DATABASE } = serverConfig

  connectPromise = (async () => {
    setStatus('connecting')
    const uriCandidates = buildSpacetimeUriCandidates(SPACETIMEDB_URI)
    const errors: string[] = []

    for (const [index, candidate] of uriCandidates.entries()) {
      const isLastCandidate = index === uriCandidates.length - 1
      try {
        await connectWithUri(candidate, SPACETIMEDB_DATABASE, isLastCandidate)

        if (candidate !== SPACETIMEDB_URI) {
          const currentConfig = useServerConfigStore.getState().config
          if (currentConfig && currentConfig.spacetimedbUri === SPACETIMEDB_URI) {
            useServerConfigStore.getState().setConfig({
              ...currentConfig,
              spacetimedbUri: candidate,
            })
          }
        }
        return
      } catch (error) {
        errors.push(`${candidate} -> ${getConnectionErrorDetails(error)}`)
      }
    }

    throw new Error(
      `SpacetimeDB connection failed at ${SPACETIMEDB_URI}. Tried ${uriCandidates.length} URI(s): ${errors.join('; ')}`,
    )
  })()

  try {
    await connectPromise
    reconnectAttempts = 0
    startHeartbeat()
  } finally {
    connectPromise = null
  }
}

export function disconnect(): void {
  // Suppress auto-reconnect and stop the heartbeat for a caller-initiated close.
  intentionalDisconnect = true
  stopHeartbeat()
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  if (connection) {
    const offlineReducer = connection.reducers?.setPresenceOffline
    if (typeof offlineReducer === 'function') {
      void offlineReducer({})
    }
  }
  teardownConnection(true)
  connectPromise = null
  setStatus('disconnected')
  resetClientState()
}

const REDUCER_CALL_TIMEOUT_MS = 15000

export async function call<TArgs extends Record<string, unknown>>(reducer: string, args?: TArgs): Promise<void> {
  // Reconnect on a dead/stale socket, not just a null one. A WebSocket culled
  // mid-idle leaves `connection` non-null but inactive; firing a reducer into
  // it never acks and hangs forever. `connect()` is idempotent (no-ops when
  // already active) and rebuilds when not.
  if (!connection?.isActive) {
    await connect()
  }

  const currentConnection = connection
  if (!currentConnection?.isActive) {
    throw new Error('SpacetimeDB connection is not available')
  }

  const reducersByName = currentConnection.reducers as unknown as
    Record<string, ((args?: Record<string, unknown>) => Promise<void>) | undefined>
  const reducerFn = reducersByName?.[reducer]
  if (typeof reducerFn !== 'function') {
    throw new Error(`Reducer not found: ${reducer}`)
  }

  // Bound the call so a silently-dropped socket surfaces as an error the caller
  // can retry, instead of an indefinitely pending promise.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`Reducer "${reducer}" timed out after ${REDUCER_CALL_TIMEOUT_MS}ms`)),
      REDUCER_CALL_TIMEOUT_MS,
    )
  })
  try {
    await Promise.race([reducerFn(args ?? {}), timeout])
  } finally {
    clearTimeout(timeoutHandle)
  }
}

// ─── Connection lifecycle callbacks ──────────────────────────────────────────

export const onConnect = async (): Promise<void> => {
  setStatus('connected')
}

export const onDisconnect = async (): Promise<void> => {
  setStatus('disconnected')
}

export const onError = async (error: unknown): Promise<void> => {
  setStatus('disconnected')
  const body = error instanceof Error ? error.message : 'Unknown connection error'
  await notify('system', {
    title: 'Connection Error',
    body,
    dedupeKey: `connection_error:${body}`,
  })
}

// ─── Public client ────────────────────────────────────────────────────────────

export const spacetimedbClient: SpacetimeDBClient = {
  get connection() {
    return connection
  },
  connect,
  disconnect,
  call,
}

export { tables }
