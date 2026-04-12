import { DbConnection, tables } from '../../generated'
import { watchLiveTables } from './events'
import { syncAll, resetClientState } from './sync'
import { notify } from '../notifications'
import { useConnectionStore } from '../../stores/connectionStore'
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
      .withToken(getStoredToken())
      .onConnect((_conn, identity, token) => {
        const identityString =
          identity && typeof identity === 'object' && 'toHexString' in identity ?
            (identity as { toHexString(): string }).toHexString()
          : String(identity)
        useConnectionStore.getState().setStatus('connected')
        useConnectionStore.getState().setIdentity(identityString as import('../../types/domain').Identity)
        setStoredToken(token)
      })
      .onDisconnect(() => {
        useConnectionStore.getState().setStatus('disconnected')
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
        tables.user,
        tables.server,
        tables.server_member,
        tables.channel,
        tables.message,
        tables.voice_participant,
        tables.my_friends,
        tables.my_blocks,
        tables.direct_message,
        tables.my_dm_voice_participants,
        tables.my_presence_states,
        tables.my_typing_states,
        tables.my_read_states,
        tables.invite,
        tables.dm_server_invite,
      ])

    await firstSyncApplied
  } finally {
    clearTimeout(connectTimeout)
    if (!appliedOnce) {
      subscriptionHandle?.unsubscribe()
      subscriptionHandle = null
      liveEventsEnabled = false
      connection?.disconnect()
      connection = null
    }
  }
}

export async function connect(): Promise<void> {
  if (connection?.isActive) return
  if (connectPromise) return connectPromise

  const serverConfig = useServerConfigStore.getState().config
  if (!serverConfig) {
    throw new Error('Server not configured. Please complete setup first.')
  }
  const { spacetimedbUri: SPACETIMEDB_URI, spacetimedbDatabase: SPACETIMEDB_DATABASE } = serverConfig

  connectPromise = (async () => {
    useConnectionStore.getState().setStatus('connecting')
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
  } finally {
    connectPromise = null
  }
}

export function disconnect(): void {
  if (connection) {
    const offlineReducer = connection.reducers?.setPresenceOffline
    if (typeof offlineReducer === 'function') {
      void offlineReducer({})
    }
  }
  subscriptionHandle?.unsubscribe()
  subscriptionHandle = null
  liveEventsEnabled = false
  connection?.disconnect()
  connection = null
  connectPromise = null
  useConnectionStore.getState().setStatus('disconnected')
  resetClientState()
}

export async function call<TArgs extends Record<string, unknown>>(reducer: string, args?: TArgs): Promise<void> {
  if (!connection) {
    await connect()
  }

  const currentConnection = connection
  if (!currentConnection) {
    throw new Error('SpacetimeDB connection is not available')
  }

  const reducersByName = currentConnection.reducers as unknown as
    Record<string, ((args?: Record<string, unknown>) => Promise<void>) | undefined>
  const reducerFn = reducersByName?.[reducer]
  if (typeof reducerFn !== 'function') {
    throw new Error(`Reducer not found: ${reducer}`)
  }

  await reducerFn(args ?? {})
}

// ─── Connection lifecycle callbacks ──────────────────────────────────────────

export const onConnect = async (): Promise<void> => {
  useConnectionStore.getState().setStatus('connected')
}

export const onDisconnect = async (): Promise<void> => {
  useConnectionStore.getState().setStatus('disconnected')
}

export const onError = async (error: unknown): Promise<void> => {
  useConnectionStore.getState().setStatus('disconnected')
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
