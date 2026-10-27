import { AudioLinesIcon, LoaderCircleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useNoiseFilterStore } from '../../../stores/noiseFilterStore'
import { useMediaDeviceStore } from '../../../stores/mediaDeviceStore'
import { NoiseFilterSettings } from './NoiseFilterSettings'

export function NoiseFilterToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const enabled = useMediaDeviceStore((s) => s.noiseFilterEnabled)
  const status = useNoiseFilterStore((s) => s.status)
  const active = enabled && status === 'active'
  const loading = enabled && status === 'loading'

  return (
    <Popover>
      <PopoverTrigger render={
        <Button type="button" size={compact ? 'icon-xs' : 'icon-sm'} variant="outline"
          aria-label={`Noise suppression settings${active ? ', active' : ''}`}
          className={cn(
            'relative transition-[color,background-color,border-color] duration-150',
            compact ? 'size-8 rounded-md' : 'size-9 rounded-md',
            active
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground aria-expanded:bg-primary/90 aria-expanded:text-primary-foreground dark:border-primary dark:bg-primary dark:hover:bg-primary/90'
              : 'border-border/70 bg-background/35 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            className,
          )}
        />
      }>
        {loading ? <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" /> : <AudioLinesIcon className={compact ? 'size-4' : 'size-5'} />}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-72 max-w-[calc(100vw-1.5rem)] gap-3 rounded-xl p-4 shadow-lg motion-reduce:animate-none">
        <PopoverTitle className="sr-only">Microphone noise suppression</PopoverTitle>
        <NoiseFilterSettings />
      </PopoverContent>
    </Popover>
  )
}
