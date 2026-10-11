import { useId, useState, type ComponentProps } from 'react'
import { CheckIcon, LoaderCircleIcon, MonitorUpIcon, Volume2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { screenShareProfiles } from '../../../lib/screenShare'
import { useMediaDeviceStore } from '../../../stores/mediaDeviceStore'

type ScreenShareMenuProps = Pick<ComponentProps<typeof Button>, 'size' | 'className' | 'disabled'> & {
  sharing: boolean
  showLabel?: boolean
  onToggle: () => Promise<void>
}

export function ScreenShareMenu({ sharing, onToggle, disabled, size = 'icon-sm', className, showLabel = false }: ScreenShareMenuProps) {
  const [open, setOpen] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const id = useId()
  const quality = useMediaDeviceStore(s => s.screenShareQuality)
  const audio = useMediaDeviceStore(s => s.screenShareAudio)
  const setQuality = useMediaDeviceStore(s => s.setScreenShareQuality)
  const setAudio = useMediaDeviceStore(s => s.setScreenShareAudio)
  const selectedQuality = Object.hasOwn(screenShareProfiles, quality) ? quality : 'auto'
  const label = sharing ? 'Stop sharing screen' : 'Share screen'
  const button = <Button variant="outline" size={size} className={className} disabled={disabled || choosing} aria-label={label} aria-pressed={sharing || undefined} onClick={sharing ? () => void onToggle() : undefined}>
    <MonitorUpIcon />{showLabel ? label : null}
  </Button>

  async function chooseSource() {
    setChoosing(true)
    try {
      // Invoke capture in this click's activation, before any asynchronous work.
      await onToggle()
      setOpen(false)
    } finally { setChoosing(false) }
  }

  if (sharing) return button
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={button} />
    <PopoverContent side="top" align="end" sideOffset={8} className="app-scrollbar max-h-(--available-height) w-80 max-w-[calc(100vw-1.5rem)] gap-4 overflow-y-auto rounded-xl p-4 shadow-xl">
      <PopoverTitle>Share screen</PopoverTitle>
      <fieldset disabled={choosing}>
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Quality</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(screenShareProfiles).map(([value, profile]) => <label key={value} className={cn('relative flex cursor-pointer items-center justify-between gap-1 rounded-lg border px-2.5 py-2 transition-colors hover:bg-muted/60 has-focus-visible:outline-2 has-focus-visible:outline-ring', selectedQuality === value ? 'border-primary/50 bg-primary/10' : 'border-border/70')}>
            <input className="sr-only" type="radio" name={`${id}-quality`} aria-label={profile.label} value={value} checked={selectedQuality === value} onChange={() => setQuality(value as keyof typeof screenShareProfiles)} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-medium tabular-nums">{value === 'auto' ? 'Auto' : `${profile.width} × ${profile.height}`}</span>
              <span className="text-[11px] text-muted-foreground">{value === 'auto' ? 'Adaptive' : `${profile.fps} FPS`}</span>
            </span>
            {selectedQuality === value ? <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : null}
          </label>)}
        </div>
      </fieldset>
      <div className="flex items-center justify-between border-t border-border/70 pt-3">
        <label htmlFor={`${id}-audio`} className="flex cursor-pointer items-center gap-2 text-xs font-medium"><Volume2Icon className="size-4 text-muted-foreground" />Share audio</label>
        <Switch id={`${id}-audio`} checked={audio} onCheckedChange={setAudio} disabled={choosing} />
      </div>
      {audio ? <p className="-mt-2 text-[11px] leading-relaxed text-muted-foreground">Enable audio in the sharing dialog, if available.</p> : null}
      <Button className="w-full" disabled={choosing} onClick={() => void chooseSource()}>
        {choosing ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <MonitorUpIcon />}
        {choosing ? 'Choosing source…' : 'Choose what to share'}
      </Button>
    </PopoverContent>
  </Popover>
}
