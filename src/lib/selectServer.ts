import { normalizeServerUrl } from './discovery'
import { useServerConfigStore, type ServerConfig } from '../stores/serverConfigStore'
import { cancelCompatibility, commitCompatibility, ensureServerCompatibility, connectionKey, useCompatibilityStore } from './compatibility'
import { disconnect, clearStoredToken } from './spacetimedb/connection'
import { initializeSpacetime } from './spacetimedb/auth'
import { WEB_CONNECT_URL } from './runtimeConfig'
import { isHostedWebBuild } from './tauri'

let selection = 0
let trustedSelectionKey: string | null = null

/** Every user-facing host switch checks before committing or signing out. */
export async function selectServer(config: ServerConfig, options: { confirmUnknown?: boolean; trusted?: boolean } = {}): Promise<void> {
  const attempt = ++selection
  const key = connectionKey(config)
  if (trustedSelectionKey !== key) trustedSelectionKey = null
  if (options.trusted) trustedSelectionKey = key
  const proposed = useCompatibilityStore.getState().notice?.config
  if (proposed && connectionKey(proposed) !== connectionKey(config)) cancelCompatibility()
  if (isHostedWebBuild() && normalizeServerUrl(config.discoveryUrl ?? config.authServiceUrl) !== normalizeServerUrl(WEB_CONNECT_URL!)) {
    throw new Error('This web client is locked to its own server.')
  }
  if (trustedSelectionKey !== key && !useServerConfigStore.getState().requestConnect(config, options)) {
    cancelCompatibility()
    return
  }
  trustedSelectionKey = key
  const fresh = await ensureServerCompatibility(config, true)
  if (attempt !== selection) return
  const previous = useServerConfigStore.getState().config
  if (!previous || (previous.authServiceUrl !== fresh.authServiceUrl
    || previous.spacetimedbUri !== fresh.spacetimedbUri || previous.spacetimedbDatabase !== fresh.spacetimedbDatabase)) {
    disconnect()
    if (previous && (previous.authServiceUrl !== fresh.authServiceUrl
      || previous.spacetimedbDatabase !== fresh.spacetimedbDatabase)) clearStoredToken()
  }
  useServerConfigStore.getState().setConfig(fresh)
  commitCompatibility(fresh)
  await initializeSpacetime()
}

export function cancelServerSelection(): void {
  selection++
  trustedSelectionKey = null
  cancelCompatibility()
  useServerConfigStore.getState().resolvePendingHost(false)
}
