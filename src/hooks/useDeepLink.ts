import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/sonner'
import { useServerConfigStore, parseJoinLink, type ServerConfig } from '../stores/serverConfigStore'
import { initializeSpacetime } from '../lib/spacetimedb'

/**
 * Catches <c>letschat://join?…</c> deep links — cold-start (the OS launched
 * the app with the URL) and warm-start (a click while the app is already
 * running). Parses the embedded config, persists it via the server-config
 * store, kicks off the SpacetimeDB connection, and routes to <c>/</c> so the
 * App's normal redirect chain takes over.
 *
 * Module-level state (not React state) handles two real-world pitfalls:
 *
 * - <b>StrictMode mount/unmount/remount</b> — a per-instance ref starts empty
 *   on the second mount and would let duplicates through.
 * - <b>Tauri's plugin caches the cold-start URL.</b> Every call to
 *   <c>getCurrent()</c> returns the launch URL for the lifetime of the
 *   process. Without a session-wide "we've already consumed the cold-start
 *   URL" guard, any later effect remount or component remount re-applies the
 *   original config — which is why clicking "Change server" would instantly
 *   snap the user back to the cold-start instance.
 */
const WARM_DEDUPE_WINDOW_MS = 2000

let coldStartConsumed = false
let warmListenerInitialised = false
let lastWarmHandled: { url: string; at: number } | null = null

function sameConfig(a: ServerConfig | null, b: ServerConfig): boolean {
  if (!a) return false
  return (
    a.spacetimedbUri === b.spacetimedbUri
    && a.authServiceUrl === b.authServiceUrl
    && a.livekitUrl === b.livekitUrl
    && a.spacetimedbDatabase === b.spacetimedbDatabase
  )
}

export function useDeepLink(): void {
  const navigate = useNavigate()
  const setConfig = useServerConfigStore((s) => s.setConfig)

  useEffect(() => {
    let cancelled = false

    function applyUrl(raw: string, kind: 'cold' | 'warm') {
      if (kind === 'warm') {
        const now = Date.now()
        if (lastWarmHandled && lastWarmHandled.url === raw && now - lastWarmHandled.at < WARM_DEDUPE_WINDOW_MS) {
          return
        }
        lastWarmHandled = { url: raw, at: now }
      }

      const cfg = parseJoinLink(raw)
      if (!cfg) {
        toast.error('Could not understand that join link.', { id: 'deeplink:parse-error' })
        return
      }

      // Already on this instance — silently no-op. Crucially this is what
      // makes "Change server" usable: after the user clears their config and
      // picks a new one, an accidental re-fire of the cold-start URL hits
      // this guard (because the new config differs from the cached URL) only
      // if the cold-start guard somehow missed; if they happen to re-pick the
      // same instance, the no-op suppresses an unwanted toast either way.
      const previous = useServerConfigStore.getState().config
      if (sameConfig(previous, cfg)) return

      const switching = previous !== null
      setConfig(cfg)
      void initializeSpacetime()

      const toastId = `deeplink:${cfg.authServiceUrl}`
      try {
        const host = new URL(cfg.authServiceUrl).host
        toast.success(switching ? `Switched to ${host}` : `Connected to ${host}`, { id: toastId })
      } catch {
        toast.success(switching ? 'Switched instance.' : 'Connection configured.', { id: toastId })
      }
      navigate('/')
    }

    async function init() {
      let mod: typeof import('@tauri-apps/plugin-deep-link')
      try {
        mod = await import('@tauri-apps/plugin-deep-link')
      } catch {
        return
      }
      if (cancelled) return

      // Cold-start: read the launch URL exactly once per session.
      if (!coldStartConsumed) {
        coldStartConsumed = true
        try {
          const initial = await mod.getCurrent()
          if (!cancelled && initial && initial.length > 0) applyUrl(initial[0], 'cold')
        } catch {
          // Plugin not available outside Tauri — ignore.
        }
      }

      // Warm-start: subscribe exactly once per session. The plugin keeps the
      // listener alive for the process lifetime, so we don't need to (and must
      // not) unsubscribe on effect cleanup — that would silently drop URLs
      // delivered while React's strict-mode unmount/remount is in flight.
      //
      // The Rust side also emits a `letschat-deeplink-warm` event from the
      // single-instance callback so Windows/Linux warm-start URLs (which the
      // OS delivers as a process arg, not via NSAppleEventManager) reach
      // the same handler. macOS routes naturally through `onOpenUrl`.
      if (!warmListenerInitialised) {
        warmListenerInitialised = true
        try {
          const event = await import('@tauri-apps/api/event')
          await event.listen<string>('letschat-deeplink-warm', (payload) => {
            if (typeof payload.payload === 'string') applyUrl(payload.payload, 'warm')
          })
        } catch {
          // ignore — not running in Tauri
        }
        try {
          await mod.onOpenUrl((urls) => {
            for (const url of urls) applyUrl(url, 'warm')
          })
        } catch {
          warmListenerInitialised = false
        }
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [navigate, setConfig])
}
