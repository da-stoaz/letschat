import { AudioLinesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { supportsNoiseFilter } from '../../../lib/krisp'
import { useMediaDeviceStore } from '../../../stores/mediaDeviceStore'

/**
 * Soundwave button that toggles the Krisp AI noise filter on the local mic,
 * with a tooltip that briefly explains what it does.
 */
export function NoiseFilterToggle({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  const noiseFilterEnabled = useMediaDeviceStore((s) => s.noiseFilterEnabled)
  const toggleNoiseFilter = useMediaDeviceStore((s) => s.toggleNoiseFilter)
  const active = noiseFilterEnabled

  // Krisp is a desktop-only feature, so the control doesn't render on the hosted
  // web build (see `supportsNoiseFilter`).
  if (!supportsNoiseFilter()) return null

  return (
    <TooltipProvider delay={500}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size={compact ? 'icon-xs' : 'icon-sm'}
              variant="outline"
              aria-pressed={active}
              aria-label={active ? 'Turn noise filter off' : 'Turn noise filter on'}
              onClick={() => toggleNoiseFilter()}
              className={cn(
                compact ? 'h-8 w-8' : 'h-9 w-9',
                'transition-colors',
                active
                  ? 'border-emerald-400/70 bg-emerald-500/15 text-emerald-300 hover:border-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200'
                  : 'border-border/70 bg-background/35 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                className,
              )}
            />
          }
        >
          <AudioLinesIcon className={compact ? 'size-4' : 'size-5'} />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-56">
          <div className="space-y-0.5">
            <p className="font-semibold">Noise filter: {active ? 'on' : 'off'}</p>
            <p className="text-background/80">
              Removes background noise from your mic so people hear your voice clearly.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
