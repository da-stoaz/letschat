import type { ServerConfig } from '../stores/serverConfigStore'

/** Shape of the `/.well-known/letschat.json` document served by core-api. */
export interface WellKnown {
  spacetimedb?: string
  auth?: string
  livekit?: string
  database?: string
}

/** Adds a scheme if the user typed a bare host, and trims trailing slashes. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  return trimmed.includes('://') ? trimmed : `http://${trimmed}`
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
  return {
    spacetimedbUri: json.spacetimedb!,
    authServiceUrl: json.auth!,
    livekitUrl: json.livekit!,
    spacetimedbDatabase: json.database ?? 'letschat',
  }
}
