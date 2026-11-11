import type { ReactElement } from 'react'
import { Track } from 'livekit-client'
import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu'
import { ContextMenu, ContextMenuContent } from '@/components/ui/context-menu'
import { useLiveKitRoom } from '../../../lib/livekit'
import { useCallAudioStore, participantVolume } from '../../../stores/callAudioStore'
import { useConnectionStore } from '../../../stores/connectionStore'
import { useDmVoiceSessionStore } from '../../../stores/dmVoiceSessionStore'
import { useVoiceSessionStore } from '../../../stores/voiceSessionStore'
import { useVoiceStore } from '../../../stores/voiceStore'
import { VolumeSlider } from './CallVolumeMixer'

const key = (identity: string) => identity.trim().toLowerCase()

/** True when `identity` is someone else in the call this client is connected to. */
function useInMyCall(identity: string) {
  const self = useConnectionStore(s => s.identity)
  const channelId = useVoiceSessionStore(s => s.joinedChannelId)
  const partner = useDmVoiceSessionStore(s => s.joinedPartnerIdentity)
  const inChannel = useVoiceStore(s => channelId !== null
    && (s.participantsByChannel[channelId] ?? []).some(p => key(p.userIdentity) === key(identity)))
  if (self && key(self) === key(identity)) return false
  return inChannel || (partner !== null && key(partner) === key(identity))
}

function VolumeControls({ identity, name }: { identity: string; name: string }) {
  const voiceRoom = useVoiceSessionStore(s => s.room)
  const dmRoom = useDmVoiceSessionStore(s => s.room)
  const { remoteParticipants } = useLiveKitRoom(voiceRoom ?? dmRoom)
  const preferences = useCallAudioStore()
  const participant = remoteParticipants.find(p => key(p.identity) === key(identity))
  const hasStreamAudio = Boolean(participant?.getTrackPublication(Track.Source.ScreenShareAudio))
  return <>
    <p className="truncate text-sm font-medium">{name}</p>
    <VolumeSlider label="User volume" value={participantVolume(preferences, identity, 'voice')}
      onChange={volume => preferences.setParticipantVolume(identity, 'voice', volume)} />
    {hasStreamAudio ? <VolumeSlider label="Stream volume" value={participantVolume(preferences, identity, 'screen')}
      onChange={volume => preferences.setParticipantVolume(identity, 'screen', volume)} /> : null}
  </>
}

/**
 * Right-click (or long-press) a person in your current call to change how loud
 * they are for you. Outside a call, or on yourself, the child renders untouched.
 */
export function ParticipantVolumeMenu({ identity, name, children }: { identity: string | undefined; name: string; children: ReactElement }) {
  if (!useInMyCall(identity ?? '') || !identity) return children
  return <ContextMenu>
    {/* Bare trigger: the shadcn wrapper would overwrite the child's data-slot (e.g. avatar group styling). */}
    <ContextMenuPrimitive.Trigger render={children} />
    <ContextMenuContent aria-label={`${name} volume`} className="w-64 space-y-2 p-3">
      <VolumeControls identity={identity} name={name} />
    </ContextMenuContent>
  </ContextMenu>
}
