import type { ServerConfig } from '../stores/serverConfigStore'

/** Shape of the `/.well-known/letschat.json` document served by core-api. */
export interface WellKnown {
  spacetimedb?: string
  auth?: string
  livekit?: string
  database?: string
  uploadPartSizeBytes?: number
  uploadMaxFileSizeBytes?: number
  dailyUploadQuotaBytes?: number
  userStorageLimitBytes?: number
  instanceStorageLimitBytes?: number
}

/** Loopback, `.local` and private-network hosts — where plain http is normal. */
function isLocalHost(hostWithPort: string): boolean {
  const bracketed = /^\[([^\]]+)\]/.exec(hostWithPort)
  const host = (bracketed ? bracketed[1] : hostWithPort.replace(/:\d+$/, '')).toLowerCase()
  return (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

/**
 * Adds a scheme if the user typed a bare host, and trims trailing slashes.
 * A bare public host means https: the discovery document decides where every
 * credential goes, so fetching it over plain http let anyone on the path
 * redirect the whole session (BUG_ANALYSIS E3). Local hosts keep http.
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed.includes('://')) return trimmed
  return `${isLocalHost(trimmed.split('/')[0]) ? 'http' : 'https'}://${trimmed}`
}

/** An https instance must not advertise plaintext endpoints. */
function assertSecureEndpoints(base: string, json: WellKnown): void {
  if (!base.startsWith('https://')) return
  const insecure = [
    ['auth', json.auth, /^https:\/\//],
    ['spacetimedb', json.spacetimedb, /^(wss|https):\/\//],
    ['livekit', json.livekit, /^(wss|https):\/\//],
  ].filter(([, url, secure]) => !(secure as RegExp).test(url as string))
  if (insecure.length) {
    throw new Error(
      `letschat.json advertises insecure endpoints for an https server: ${insecure.map(([name]) => name).join(', ')}`,
    )
  }
}

/**
 * Fetches `/.well-known/letschat.json` from a server's base URL and maps it into
 * a {@link ServerConfig}. Throws a descriptive error if the document is missing
 * or incomplete. Shared by the desktop Setup → Discover flow and the hosted-web
 * auto-config bootstrap.
 */
export async function discoverConfig(serverUrl: string): Promise<ServerConfig> {
  const base = normalizeServerUrl(serverUrl)
  const res = await fetch(`${base}/.well-known/letschat.json`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) {
    throw new Error(`Discovery failed (${res.status}). Is /.well-known/letschat.json hosted at ${base}?`)
  }
  const json = (await res.json()) as WellKnown
  const missing: string[] = []
  if (!json.spacetimedb) missing.push('spacetimedb')
  if (!json.auth) missing.push('auth')
  if (!json.livekit) missing.push('livekit')
  if (missing.length) throw new Error(`letschat.json is missing fields: ${missing.join(', ')}`)
  assertSecureEndpoints(base, json)
  return {
    spacetimedbUri: json.spacetimedb!,
    authServiceUrl: json.auth!,
    livekitUrl: json.livekit!,
    spacetimedbDatabase: json.database ?? 'letschat',
    uploadPartSizeBytes: json.uploadPartSizeBytes,
    uploadMaxFileSizeBytes: json.uploadMaxFileSizeBytes,
    dailyUploadQuotaBytes: json.dailyUploadQuotaBytes,
    userStorageLimitBytes: json.userStorageLimitBytes,
    instanceStorageLimitBytes: json.instanceStorageLimitBytes,
  }
}
