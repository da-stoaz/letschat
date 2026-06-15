import { ConnectionQuality, type Room } from 'livekit-client'
import { SignalIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCallLatency } from '../hooks/useCallLatency'

function qualityDotClass(quality: ConnectionQuality, rttMs: number | null): string {
  if (quality === ConnectionQuality.Excellent || quality === ConnectionQuality.Good) {
    return 'bg-emerald-400'
  }
  if (quality === ConnectionQuality.Poor) {
    return 'bg-amber-400'
  }
  if (quality === ConnectionQuality.Lost) {
    return 'bg-red-500'
  }
  // Quality not yet reported — fall back to the measured RTT if we have one.
  if (rttMs === null) return 'bg-muted-foreground/50'
  if (rttMs < 150) return 'bg-emerald-400'
  if (rttMs < 300) return 'bg-amber-400'
  return 'bg-red-500'
}

function qualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return 'Excellent connection'
    case ConnectionQuality.Good:
      return 'Good connection'
    case ConnectionQuality.Poor:
      return 'Poor connection'
    case ConnectionQuality.Lost:
      return 'Connection lost'
    default:
      return 'Measuring connection'
  }
}

/**
 * Compact live ping/latency indicator for an active call: a quality-colored dot
 * plus the round-trip time to the media server in milliseconds.
 */
export function CallLatencyBadge({
  room,
  className,
  compact = false,
}: {
  room: Room | null
  className?: string
  compact?: boolean
}) {
  const { rttMs, quality } = useCallLatency(room)

  if (!room) return null

  const label = qualityLabel(quality)
  const valueText = rttMs === null ? '—' : `${rttMs} ms`

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 font-medium tabular-nums text-muted-foreground',
        compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs',
        className,
      )}
      title={`${label}${rttMs === null ? '' : ` · ${rttMs} ms round-trip`}`}
      aria-label={`Call latency: ${rttMs === null ? 'measuring' : `${rttMs} milliseconds`}, ${label}`}
    >
      <span className={cn('size-2 shrink-0 rounded-full', qualityDotClass(quality, rttMs))} aria-hidden />
      {compact ? null : <SignalIcon className="size-3.5" aria-hidden />}
      <span>{valueText}</span>
    </span>
  )
}
