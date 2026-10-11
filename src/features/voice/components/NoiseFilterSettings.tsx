import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { supportsNoiseFilter } from '../../../lib/noiseFilter'
import { useMediaDeviceStore, type NoiseFilterModel } from '../../../stores/mediaDeviceStore'
import { useNoiseFilterStore } from '../../../stores/noiseFilterStore'

const models = [
  { value: 'rnnoise', label: 'RNNoise' },
  { value: 'deepfilternet', label: 'DeepFilterNet 3' },
] satisfies { value: NoiseFilterModel; label: string }[]

function NoiseFilterStatus({ enabled, supported }: { enabled: boolean; supported: boolean }) {
  const status = useNoiseFilterStore(s => s.status)
  const error = useNoiseFilterStore(s => s.error)
  let message = 'Starts when your microphone is on.'
  if (!supported) message = 'Not available on this device.'
  else if (!enabled) message = 'Noise suppression is off.'
  else if (status === 'error') message = error ?? 'Could not start noise suppression. Turn it off and on to retry.'
  else if (status === 'loading') message = 'Starting noise suppression…'
  else if (status === 'active') message = 'Filtering your microphone.'

  return <p role="status" className={cn('border-t pt-3 text-xs leading-relaxed', enabled && status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{message}</p>
}

export function NoiseFilterSettings() {
  const id = useId()
  const enabled = useMediaDeviceStore(s => s.noiseFilterEnabled)
  const model = useMediaDeviceStore(s => s.noiseFilterModel)
  const setEnabled = useMediaDeviceStore(s => s.setNoiseFilterEnabled)
  const setModel = useMediaDeviceStore(s => s.setNoiseFilterModel)
  const supported = supportsNoiseFilter()

  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={`${id}-enabled`}>Noise suppression</Label>
      <Switch id={`${id}-enabled`} aria-describedby={`${id}-description`} checked={enabled} disabled={!supported} onCheckedChange={setEnabled} />
    </div>
    <p id={`${id}-description`} className="text-xs leading-relaxed text-muted-foreground">
      Reduces microphone background noise so your voice stays clear.
    </p>
    {enabled && supported ? <div className="space-y-2">
      <Label htmlFor={`${id}-model`} className="text-xs">Filter</Label>
      <Select items={models} value={model} onValueChange={value => { if (value) setModel(value) }}>
        <SelectTrigger id={`${id}-model`} aria-describedby={`${id}-hint`} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {models.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
        {model === 'rnnoise' ? 'Lightweight filtering with low CPU use.' : 'More intensive filtering. Uses more CPU and might add some delay.'}
      </p>
    </div> : null}
    <NoiseFilterStatus enabled={enabled} supported={supported} />
  </div>
}
