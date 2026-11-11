import { useEffect, useState } from 'react'
import { useServerConfigStore } from '../stores/serverConfigStore'
import { discoverConfig, normalizeServerUrl } from '../lib/discovery'
import { selectServer } from '../lib/selectServer'
import { isHostedWebBuild } from '../lib/tauri'
import { WEB_CONNECT_URL } from '../lib/runtimeConfig'

export type WebAutoConfigStatus = 'inactive' | 'discovering' | 'done' | 'failed'
// Share work across StrictMode remounts, but let every mounted subscriber finish.
let bootstrap: Promise<void> | null = null

export function useWebAutoConfig(): WebAutoConfigStatus {
  const hasHydrated = useServerConfigStore((s) => s.hasHydrated)
  const hosted = isHostedWebBuild()
  const [status, setStatus] = useState<WebAutoConfigStatus>(hosted ? 'discovering' : 'inactive')
  useEffect(() => {
    if (!hosted || !hasHydrated) return
    let cancelled = false
    bootstrap ??= (async () => {
      const root = normalizeServerUrl(WEB_CONNECT_URL!)
      const saved = useServerConfigStore.getState().config
      const config = saved && (saved.discoveryUrl ?? saved.authServiceUrl) === root
        ? saved : await discoverConfig(root)
      await selectServer(config)
    })()
    void bootstrap.then(() => { if (!cancelled) setStatus('done') }, () => { if (!cancelled) setStatus('failed') })
    return () => { cancelled = true }
  }, [hosted, hasHydrated])
  return status
}
