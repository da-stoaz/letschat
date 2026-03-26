import { useEffect } from 'react'
import { reducers } from '../lib/spacetimedb'
import { useConnectionStore } from '../stores/connectionStore'
import { usePresenceStore } from '../stores/presenceStore'

const NOW_TICK_INTERVAL_MS = 1000
const HEARTBEAT_INTERVAL_MS = 30_000
const ACTIVITY_THROTTLE_MS = 5_000

export function usePresenceLifecycle() {
  const status = useConnectionStore((s) => s.status)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const setNowMs = usePresenceStore((s) => s.setNowMs)

  useEffect(() => {
    const ticker = window.setInterval(() => {
      setNowMs(Date.now())
    }, NOW_TICK_INTERVAL_MS)
    return () => {
      window.clearInterval(ticker)
    }
  }, [setNowMs])

  useEffect(() => {
    if (status !== 'connected' || !selfIdentity) return

    let lastTouchAt = 0
    const touchPresence = () => {
      const now = Date.now()
      if (now - lastTouchAt < ACTIVITY_THROTTLE_MS) return
      lastTouchAt = now
      void reducers.touchPresence().catch(() => undefined)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        touchPresence()
      }
    }

    const onUnload = () => {
      void reducers.setPresenceOffline().catch(() => undefined)
    }

    touchPresence()

    const heartbeat = window.setInterval(() => {
      void reducers.touchPresence().catch(() => undefined)
    }, HEARTBEAT_INTERVAL_MS)

    window.addEventListener('pointerdown', touchPresence, { passive: true })
    window.addEventListener('keydown', touchPresence, { passive: true })
    window.addEventListener('mousemove', touchPresence, { passive: true })
    window.addEventListener('focus', touchPresence)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onUnload)
    window.addEventListener('beforeunload', onUnload)

    return () => {
      window.clearInterval(heartbeat)
      window.removeEventListener('pointerdown', touchPresence)
      window.removeEventListener('keydown', touchPresence)
      window.removeEventListener('mousemove', touchPresence)
      window.removeEventListener('focus', touchPresence)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onUnload)
      window.removeEventListener('beforeunload', onUnload)
      void reducers.setPresenceOffline().catch(() => undefined)
    }
  }, [selfIdentity, status])
}
