import { useEffect } from 'react'
import { useConnectionStore } from '../stores/connectionStore'
import { usePresenceStore } from '../stores/presenceStore'

const HEARTBEAT_INTERVAL_MS = 30_000
const ACTIVITY_THROTTLE_MS = 5_000

export function usePresenceLifecycle() {
  const status = useConnectionStore((s) => s.status)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const setNowMs = usePresenceStore((s) => s.setNowMs)
  const touchSeen = usePresenceStore((s) => s.touchSeen)
  const touchActive = usePresenceStore((s) => s.touchActive)

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      const now = Date.now()
      setNowMs(now)
      if (status === 'connected' && selfIdentity) {
        touchSeen(selfIdentity, now)
      }
    }, HEARTBEAT_INTERVAL_MS)

    return () => {
      window.clearInterval(heartbeat)
    }
  }, [selfIdentity, setNowMs, status, touchSeen])

  useEffect(() => {
    if (status !== 'connected' || !selfIdentity) return

    let lastActivityAt = 0
    const handleActivity = () => {
      const now = Date.now()
      if (now - lastActivityAt < ACTIVITY_THROTTLE_MS) return
      lastActivityAt = now
      setNowMs(now)
      touchActive(selfIdentity, now)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleActivity()
      }
    }

    window.addEventListener('pointerdown', handleActivity, { passive: true })
    window.addEventListener('keydown', handleActivity, { passive: true })
    window.addEventListener('mousemove', handleActivity, { passive: true })
    window.addEventListener('focus', handleActivity)
    document.addEventListener('visibilitychange', onVisibility)

    handleActivity()

    return () => {
      window.removeEventListener('pointerdown', handleActivity)
      window.removeEventListener('keydown', handleActivity)
      window.removeEventListener('mousemove', handleActivity)
      window.removeEventListener('focus', handleActivity)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [selfIdentity, setNowMs, status, touchActive])
}

