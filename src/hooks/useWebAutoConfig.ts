import { useEffect, useState } from 'react'
import { useServerConfigStore } from '../stores/serverConfigStore'
import { discoverConfig } from '../lib/discovery'
import { initializeSpacetime } from '../lib/spacetimedb'
import { isHostedWebBuild } from '../lib/tauri'

export type WebAutoConfigStatus = 'inactive' | 'discovering' | 'done' | 'failed'

/**
 * The connect URL baked into a hosted-web build (e.g. https://auth.example.com).
 * Unset on desktop builds and local dev, where the normal Setup flow is used.
 */
const WEB_CONNECT_URL = (import.meta.env.VITE_WEB_CONNECT_URL as string | undefined)?.trim() || undefined

// Module-level guard: run the one-shot discovery at most once per page load,
// surviving React StrictMode's mount/unmount/remount.
let bootstrapStarted = false

/**
 * Hosted-web bootstrap. A web build is single-tenant — locked to its own
 * deployment — so when `VITE_WEB_CONNECT_URL` is baked in and we're running in a
 * browser (not the Tauri desktop shell), auto-discover the instance config from
 * its connect URL and connect, skipping the desktop "pick a server" Setup
 * screen. Falls back to Setup (status `failed`) if discovery fails, so the user
 * is never stranded.
 *
 * Returns the bootstrap status so the app shell can show a splash while
 * discovering instead of flashing the Setup page.
 */
export function useWebAutoConfig(): WebAutoConfigStatus {
  const hasHydrated = useServerConfigStore((s) => s.hasHydrated)
  const setConfig = useServerConfigStore((s) => s.setConfig)

  const isHostedWeb = isHostedWebBuild() && WEB_CONNECT_URL !== undefined

  const [status, setStatus] = useState<WebAutoConfigStatus>(isHostedWeb ? 'discovering' : 'inactive')

  useEffect(() => {
    if (!isHostedWeb || !hasHydrated || bootstrapStarted) return
    bootstrapStarted = true

    let cancelled = false
    void (async () => {
      try {
        // A persisted config (returning user) is honored as-is — no re-discovery.
        if (useServerConfigStore.getState().config) {
          if (!cancelled) setStatus('done')
          return
        }
        const cfg = await discoverConfig(WEB_CONNECT_URL!)
        if (cancelled) return
        setConfig(cfg)
        await initializeSpacetime()
        if (!cancelled) setStatus('done')
      } catch (error) {
        console.error('[web] auto-config discovery failed:', error)
        // Allow the Setup fallback (and a later manual retry) to proceed.
        bootstrapStarted = false
        if (!cancelled) setStatus('failed')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isHostedWeb, hasHydrated, setConfig])

  return status
}
