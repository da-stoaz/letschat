import { useEffect, useMemo, useState } from 'react'

function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
  }
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function useOngoingCallDuration(startedAt: string | null, running: boolean): string | null {
  const [nowMs, setNowMs] = useState(Date.now())

  useEffect(() => {
    if (!running || !startedAt) return
    setNowMs(Date.now())
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [running, startedAt])

  return useMemo(() => {
    if (!running || !startedAt) return null
    const startedAtMs = Date.parse(startedAt)
    if (!Number.isFinite(startedAtMs)) return null
    return formatElapsed((nowMs - startedAtMs) / 1000)
  }, [nowMs, running, startedAt])
}
