import { useEffect, useState } from 'react'
import { MonitorUpIcon, Settings2Icon, Volume2Icon, VolumeXIcon } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { assertActiveCallRoom, isCallCancelled, listLivekitDevices, setLocalCameraEnabled, switchRoomDevice } from '../../../lib/livekit'
import { useMediaDeviceStore } from '../../../stores/mediaDeviceStore'
import type { ActiveCall } from '../hooks/useActiveCall'
import { NoiseFilterToggle } from './NoiseFilterToggle'

type DeviceKind = 'audioinput' | 'audiooutput' | 'videoinput'
type Devices = Record<DeviceKind, { deviceId: string; label: string }[]>
const kinds: DeviceKind[] = ['audioinput', 'audiooutput', 'videoinput']

export function CallOptions({ call, open, onOpenChange, inline = false, collapseDevices = false }: { call: ActiveCall; open: boolean; onOpenChange: (open: boolean) => void; inline?: boolean; collapseDevices?: boolean }) {
  const preferences = useMediaDeviceStore()
  const [devices, setDevices] = useState<Devices>({ audioinput: [], audiooutput: [], videoinput: [] })
  const [changing, setChanging] = useState(false)
  const canChooseOutput = typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function'
  const visible = inline || open
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void Promise.all(kinds.map((kind) => listLivekitDevices(kind, false))).then(([audioinput, audiooutput, videoinput]) => {
      if (!cancelled) setDevices({ audioinput, audiooutput, videoinput })
    })
    return () => { cancelled = true }
  }, [visible, call.room])

  const selectDevice = async (kind: DeviceKind, deviceId: string) => {
    const room = call.room
    if (!room || !deviceId) return
    setChanging(true)
    try {
      assertActiveCallRoom(room)
      await switchRoomDevice(room, kind, deviceId)
      assertActiveCallRoom(room)
      if (kind === 'audioinput' && !call.muted) {
        await room.localParticipant.setMicrophoneEnabled(false)
        assertActiveCallRoom(room)
        await room.localParticipant.setMicrophoneEnabled(true)
        assertActiveCallRoom(room)
      }
      if (kind === 'videoinput' && call.sharingCamera) {
        await setLocalCameraEnabled(room, true, deviceId)
        assertActiveCallRoom(room)
      }
      const setters = { audioinput: preferences.setAudioInputId, audiooutput: preferences.setAudioOutputId, videoinput: preferences.setVideoInputId }
      setters[kind](deviceId)
      call.setError(null)
    } catch (error) {
      if (!isCallCancelled(error)) {
        try { assertActiveCallRoom(room); call.setError(error instanceof Error ? error.message : 'Could not switch device.') } catch { /* Previous call ended. */ }
      }
    } finally { setChanging(false) }
  }
  const selected = { audioinput: preferences.audioInputId, audiooutput: preferences.audioOutputId, videoinput: preferences.videoInputId }
  const profiles = call.tiles.filter((tile) => tile.tileType === 'profile')
  const labels = { audioinput: 'Microphone', audiooutput: 'Speaker', videoinput: 'Camera' }
  const content = (
        <div aria-label={inline ? 'Call devices and options' : undefined} role={inline ? 'group' : undefined} className={cn('min-h-0', inline ? 'flex flex-wrap items-end justify-center gap-3' : 'space-y-4 overflow-y-auto px-4 pb-4')}>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={!call.joined} aria-pressed={call.deafened} onClick={() => void call.onToggleDeafen()}>{call.deafened ? <VolumeXIcon /> : <Volume2Icon />}{call.deafened ? 'Unmute call audio' : 'Mute call audio'}</Button>
            {call.hasScreenCapture ? <Button variant="outline" disabled={!call.joined} aria-pressed={call.sharingScreen} onClick={() => void call.onToggleScreenShare()}><MonitorUpIcon />{call.sharingScreen ? 'Stop sharing screen' : 'Share screen'}</Button> : null}
            <NoiseFilterToggle compact />
          </div>
          {collapseDevices ? <Popover>
            <PopoverTrigger render={<Button variant="outline" />}><Settings2Icon />Devices</PopoverTrigger>
            <PopoverContent side="top" align="end" className="max-h-[calc(100dvh-6rem)] overflow-y-auto p-4">{deviceControls()}</PopoverContent>
          </Popover> : deviceControls()}
          {!inline && call.error ? <p role="alert" className="text-sm break-words text-destructive">{call.error}</p> : null}
          {!inline ? <div className="space-y-2 border-t pt-3">
            <h3 className="text-sm font-medium">Participants · {profiles.length}</h3>
            {profiles.map((tile) => <p className="text-sm break-words" key={tile.key}>{tile.displayName}{tile.isLocal ? ' (you)' : ''}{tile.muted ? ' · Muted' : ''}</p>)}
          </div> : null}
        </div>
  )
  function deviceControls() {
    return <div className={cn('min-w-0', inline && !collapseDevices ? 'flex flex-wrap gap-3' : 'space-y-4')}>
          {kinds.map((kind) => (
            <label key={kind} className={cn('block min-w-0 space-y-1 text-sm font-medium', inline && !collapseDevices && 'w-48 max-w-full')}>
              <span>{labels[kind]}</span>
              {kind === 'audiooutput' && !canChooseOutput ? <span className="flex h-8 items-center rounded-lg border px-2.5 text-sm text-muted-foreground">System output</span> : <select data-slot="call-device-select" className="h-8 w-full min-w-0 truncate rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground/70" value={selected[kind] ?? 'default'} disabled={!call.joined || changing || devices[kind].length === 0} onChange={(event) => void selectDevice(kind, event.target.value)}>
                {!devices[kind].some((device) => device.deviceId === 'default') ? <option value="default">System default</option> : null}
                {devices[kind].map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
              </select>}
            </label>
          ))}
          </div>
  }
  if (inline) return content
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader><SheetTitle>Call options</SheetTitle></SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  )
}
