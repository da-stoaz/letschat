import { useId } from 'react'
import { SlidersHorizontalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { useCallAudioStore, volumePercent } from '../../../stores/callAudioStore'

export function VolumeSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const id = useId()
  return <div className="min-w-0 space-y-1">
    <div className="flex items-center justify-between gap-3 text-sm">
      <label htmlFor={id} className="min-w-0 break-words">{label}</label>
      <output htmlFor={id} className="shrink-0 tabular-nums text-muted-foreground">{Math.round(value)}%</output>
    </div>
    <input id={id} type="range" min={0} max={200} step={1} value={value}
      aria-valuetext={`${Math.round(value)} percent`}
      onChange={event => onChange(Number(event.target.value))}
      // Keep every key but Escape/Tab for the slider, so a surrounding menu can't eat arrows/Home/End.
      onKeyDown={event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation() }}
      className="h-6 w-full cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
  </div>
}

export function MasterVolumeControl() {
  const volume = useCallAudioStore(s => s.masterVolume)
  const setVolume = useCallAudioStore(s => s.setMasterVolume)
  return <VolumeSlider label="Call volume" value={volumePercent(volume)} onChange={setVolume} />
}

// Per-person levels live on the person: right-click them (ParticipantVolumeMenu).
export function CallVolumeMixer({ compact = false, className }: { compact?: boolean; className?: string }) {
  return <Popover>
    <PopoverTrigger render={<Button variant="outline" size={compact ? 'icon' : 'default'} className={className} aria-label="Call volume controls" />}>
      <SlidersHorizontalIcon className="size-4" />{compact ? null : 'Volume'}
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-1.5rem)] gap-4 p-4">
      <PopoverTitle>Call volume</PopoverTitle>
      <MasterVolumeControl />
    </PopoverContent>
  </Popover>
}
