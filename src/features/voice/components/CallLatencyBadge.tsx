import { ConnectionQuality, type Room } from 'livekit-client'
import { SignalHighIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCallLatency } from '../hooks/useCallLatency'

function qualityColorClass(quality: ConnectionQuality, rttMs: number | null): string {
  if (quality === ConnectionQuality.Excellent || quality === ConnectionQuality.Good) {
    return 'text-emerald-400'
  }
  if (quality === ConnectionQuality.Poor) {
    return 'text-amber-400'
  }
  if (quality === ConnectionQuality.Lost) {
    return 'text-red-500'
  }
  // Quality not yet reported — fall back to the measured RTT if we have one.
  if (rttMs === null) return 'text-emerald-400'
  if (rttMs < 150) return 'text-emerald-400'
  if (rttMs < 300) return 'text-amber-400'
  return 'text-red-500'
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
      return 'Connected'
  }
}

/**
 * Compact live connection indicator for an active call: a quality-colored
 * signal icon plus the round-trip time to the media server in milliseconds.
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
  const valueText = rttMs === null ? '— ms' : `${rttMs} ms`

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 font-medium tabular-nums',
        compact ? 'h-8 px-2 text-[11px]' : 'h-9 px-2.5 text-xs',
        className,
      )}
      title={`${label}${rttMs === null ? '' : ` · ${rttMs} ms round-trip`}`}
      aria-label={`Call connection: ${label}${rttMs === null ? '' : `, ${rttMs} milliseconds round-trip`}`}
    >
      <SignalHighIcon className={cn(compact ? 'size-4' : 'size-5', qualityColorClass(quality, rttMs))} aria-hidden />
      <span className="text-muted-foreground">{valueText}</span>
    </span>
  )
}
