import { useId } from 'react'
import { Track, type Room } from 'livekit-client'
import { SlidersHorizontalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { useLiveKitRoom } from '../../../lib/livekit'
import { useCallAudioStore, participantVolume, volumePercent } from '../../../stores/callAudioStore'
import { useMembersStore } from '../../../stores/membersStore'
import { useUsersStore } from '../../../stores/usersStore'

function VolumeSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const id = useId()
  return <div className="min-w-0 space-y-1">
    <div className="flex items-center justify-between gap-3 text-sm">
      <label htmlFor={id} className="min-w-0 break-words">{label}</label>
      <output htmlFor={id} className="shrink-0 tabular-nums text-muted-foreground">{Math.round(value)}%</output>
    </div>
    <input id={id} type="range" min={0} max={200} step={1} value={value}
      aria-valuetext={`${Math.round(value)} percent`}
      onChange={event => onChange(Number(event.target.value))}
      className="h-6 w-full cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
  </div>
}

export function MasterVolumeControl() {
  const volume = useCallAudioStore(s => s.masterVolume)
  const setVolume = useCallAudioStore(s => s.setMasterVolume)
  return <VolumeSlider label="Call volume" value={volumePercent(volume)} onChange={setVolume} />
}

export function CallVolumeMixer({ room, deafened, compact = false, className }: { room: Room | null; deafened: boolean; compact?: boolean; className?: string }) {
  const { remoteParticipants } = useLiveKitRoom(room)
  const preferences = useCallAudioStore()
  const users = useUsersStore(s => s.byIdentity)
  const members = useMembersStore(s => s.membersByServer)
  const names = new Map([...Object.values(members).flat().flatMap(member => member.user ? [member.user] : []), ...Object.values(users)]
    .map(user => [user.identity.trim().toLowerCase(), user.displayName || user.username]))

  return <Popover>
    <PopoverTrigger render={<Button variant="outline" size={compact ? 'icon' : 'default'} className={className} aria-label="Call volume controls" />}>
      <SlidersHorizontalIcon className="size-4" />{compact ? null : 'Volume'}
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="max-h-[min(70dvh,32rem)] w-80 max-w-[calc(100vw-1.5rem)] gap-4 overflow-y-auto p-4">
      <PopoverTitle>Call volume</PopoverTitle>
      <p className="text-xs text-muted-foreground">Changes affect only what you hear and are saved on this device.</p>
      <p className="text-xs text-muted-foreground">100% is original volume. Higher levels boost quiet audio.</p>
      <MasterVolumeControl />
      {deafened ? <p role="status" className="text-xs text-muted-foreground">Call audio is muted. Your volume levels will apply when you unmute.</p> : null}
      {remoteParticipants.filter(participant => !participant.isLocal && participant.identity !== room?.localParticipant.identity).map(participant => {
        const identity = participant.identity
        const name = names.get(identity.trim().toLowerCase()) ?? participant.name ?? identity.slice(0, 12)
        const hasScreen = participant.getTrackPublication(Track.Source.ScreenShare) || participant.getTrackPublication(Track.Source.ScreenShareAudio)
        return <div key={identity} className="space-y-2 border-t pt-3">
          <VolumeSlider label={`Voice · ${name}`} value={participantVolume(preferences, identity, 'voice')}
            onChange={volume => preferences.setParticipantVolume(identity, 'voice', volume)} />
          {hasScreen ? <VolumeSlider label={`Stream · ${name}`} value={participantVolume(preferences, identity, 'screen')}
            onChange={volume => preferences.setParticipantVolume(identity, 'screen', volume)} /> : null}
        </div>
      })}
    </PopoverContent>
  </Popover>
}
