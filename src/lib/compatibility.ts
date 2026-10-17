import { create } from 'zustand'
import { configFromDiscovery, DiscoveryHttpError, fetchWellKnown, type WellKnown } from './discovery'
import { evaluateCompatibility, type CompatibilityResult } from './clientCompatibility'
import { useServerConfigStore, type ServerConfig, type HostChange } from '../stores/serverConfigStore'

export class CompatibilityError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable = false) { super(message); this.retryable = retryable }
}

type Notice = {
  config: ServerConfig
  status: CompatibilityResult['status'] | 'checking' | 'unreachable' | 'trust'
  message: string
  document: WellKnown
  fingerprint: string
}

export const useCompatibilityStore = create<{
  notice: Notice | null
  admittedKey: string | null
}>(() => ({ notice: null, admittedKey: null }))

export function connectionKey(config: ServerConfig): string {
  return JSON.stringify([config.discoveryUrl ?? config.authServiceUrl, config.authServiceUrl,
    config.spacetimedbUri, config.spacetimedbDatabase, config.livekitUrl])
}

let generation = 0
let flight: { key: string; promise: Promise<ServerConfig> } | null = null
let acknowledged: string | null = null
let selectedKey: string | null = null
let permit: string | null = null

export function isServerAdmitted(config: ServerConfig | null): boolean {
  return !!config && useCompatibilityStore.getState().admittedKey === connectionKey(config)
}

/** Cancel only the proposed switch. The current host's admission and session survive. */
export function cancelCompatibility(): void {
  generation++
  flight = null
  permit = null
  acknowledged = null
  selectedKey = null
  useCompatibilityStore.setState({ notice: null })
}

export function acknowledgeCompatibility(): void {
  const notice = useCompatibilityStore.getState().notice
  if (notice?.status === 'unknown') acknowledged = notice.fingerprint
}

export function commitCompatibility(config: ServerConfig): void {
  if (permit !== connectionKey(config)) throw new CompatibilityError('The server check was superseded. Please try again.')
  useCompatibilityStore.setState({ admittedKey: permit, notice: null })
}

/** One shared preflight; no credentials are sent by discovery. */
export function ensureServerCompatibility(config: ServerConfig, refresh = false): Promise<ServerConfig> {
  const key = connectionKey(config)
  if (flight?.key === key) return flight.promise
  if (!refresh && isServerAdmitted(config)) return Promise.resolve(config)
  if (selectedKey !== key) acknowledged = null
  selectedKey = key
  const attempt = ++generation
  const assertCurrent = () => {
    if (attempt !== generation) throw new CompatibilityError('The server check was cancelled.')
  }
  useCompatibilityStore.setState({ notice: { config, status: 'checking', message: 'Checking server compatibility…', document: {}, fingerprint: '' } })
  const promise = (async () => {
    let document: WellKnown = {}
    let fresh = config
    try {
      // Also validates saved/join-link details before allowing legacy fallback.
      configFromDiscovery(config.discoveryUrl ?? config.authServiceUrl, {
        auth: config.authServiceUrl, spacetimedb: config.spacetimedbUri,
        livekit: config.livekitUrl, database: config.spacetimedbDatabase,
      })
      try {
        document = await fetchWellKnown(config.discoveryUrl ?? config.authServiceUrl)
        fresh = configFromDiscovery(config.discoveryUrl ?? config.authServiceUrl, document)
      } catch (error) {
        if (!(error instanceof DiscoveryHttpError && error.status === 404)) throw error
      }
    } catch (error) {
      assertCurrent()
      const message = error instanceof Error ? error.message : 'Could not reach this server.'
      // A failed refresh must not leave a previously admitted active host authorised.
      if (isServerAdmitted(config)) useCompatibilityStore.setState({ admittedKey: null })
      useCompatibilityStore.setState({ notice: { config, status: 'unreachable', message, document, fingerprint: '' } })
      throw new CompatibilityError(message, true)
    }
    assertCurrent()
    const result = evaluateCompatibility(document)
    const fingerprint = JSON.stringify([connectionKey(fresh), document.clientProtocol, document.minClient,
      document.serverVersion, document.recommendedClient, document.web])
    const notice: Notice = { config, ...result, document, fingerprint }
    if (result.status === 'incompatible' || (result.status === 'unknown' && acknowledged !== fingerprint)) {
      if (isServerAdmitted(config)) useCompatibilityStore.setState({ admittedKey: null })
      useCompatibilityStore.setState({ notice })
      throw new CompatibilityError(result.message)
    }
    const fields: HostChange['field'][] = ['authServiceUrl', 'spacetimedbUri', 'livekitUrl', 'spacetimedbDatabase']
    const changes = fields.flatMap(field => config[field] === fresh[field] ? [] : [{ field, stored: config[field], incoming: fresh[field] }])
    if (changes.length) {
      if (isServerAdmitted(config)) useCompatibilityStore.setState({ admittedKey: null })
      useServerConfigStore.setState({ pendingHost: { config: fresh, changes, reason: 'changed' } })
      useCompatibilityStore.setState({ notice: { ...notice, status: 'trust' } })
      throw new CompatibilityError('Confirm the changed server connection details.')
    }
    permit = connectionKey(fresh)
    // Refreshing the active host can safely update non-identity discovery data.
    const active = useServerConfigStore.getState().config
    if (active && connectionKey(active) === key) {
      useServerConfigStore.getState().setConfig(fresh)
      commitCompatibility(fresh)
    } else {
      useCompatibilityStore.setState({ notice: null })
    }
    return fresh
  })().finally(() => { if (attempt === generation) flight = null })
  flight = { key, promise }
  return promise
}

/** HTTP entry points use the same admission as realtime, and reject stale host work. */
export async function requireCurrentCompatibility(refresh = false): Promise<string> {
  const config = useServerConfigStore.getState().config
  if (!config) throw new CompatibilityError('Choose a server first.')
  const fresh = await ensureServerCompatibility(config, refresh)
  const active = useServerConfigStore.getState().config
  if (!active || connectionKey(active) !== connectionKey(fresh)) throw new CompatibilityError('The selected server changed.')
  return connectionKey(fresh)
}
