import './noise-filter-storage'
import { createRoot } from 'react-dom/client'
import { Room, Track, type RemoteParticipant } from 'livekit-client'
import { CallVolumeMixer } from '../../src/features/voice/components/CallVolumeMixer'
import { CallLatencyBadge } from '../../src/features/voice/components/CallLatencyBadge'
import { NoiseFilterToggle } from '../../src/features/voice/components/NoiseFilterToggle'
import { useNoiseFilterStore } from '../../src/stores/noiseFilterStore'
import { AudioTab } from '../../src/features/settings/AudioTab'
import { useCallAudioStore } from '../../src/stores/callAudioStore'
import { VoiceMediaStage, type VoiceMediaTile } from '../../src/features/voice/components/VoiceMediaStage'
import { MemberPanel } from '../../src/layouts/app-layout/MemberPanel'
import { VoiceChannelButton } from '../../src/layouts/app-layout/VoiceChannelButton'
import { useConnectionStore } from '../../src/stores/connectionStore'
import { useVoiceSessionStore } from '../../src/stores/voiceSessionStore'
import { useVoiceStore } from '../../src/stores/voiceStore'
import type { ServerMemberWithUser } from '../../src/stores/membersStore'
import type { Channel, VoiceParticipant } from '../../src/types/domain'
import '../../src/index.css'

document.documentElement.classList.add('dark')
const room = new Room()
// Presentation fixture only; the RTC suite covers real tracks and playback.
for (const [identity, name] of [['alice', 'Alice'], ['bob', 'Bob with a longer display name']]) {
  room.remoteParticipants.set(identity, {
    identity, name, isLocal: false, videoTrackPublications: new Map(),
    getTrackPublication: (source: Track.Source) => identity === 'alice' && source === Track.Source.ScreenShareAudio ? {} : undefined,
  } as RemoteParticipant)
}
useCallAudioStore.setState({ masterVolume: 80, participantVolumes: { alice: { voice: 70, screen: 30 } } })
useNoiseFilterStore.setState({ status: 'active' })
// Alice and Bob are in our call; Carol is only a member, so she gets no volume menu.
useConnectionStore.setState({ identity: 'self' })
useVoiceSessionStore.setState({ room, joinedChannelId: 1 })
useVoiceStore.setState({ participantsByChannel: { 1: ['alice', 'bob', 'self'].map(userIdentity => ({ userIdentity }) as VoiceParticipant) } })
const people = [['alice', 'Alice'], ['bob', 'Bob with a longer display name'], ['carol', 'Carol (not in call)']]
const tiles = people.slice(0, 2).map(([identity, displayName], priority) => ({
  key: identity, displayName, avatarUrl: null, participant: room.remoteParticipants.get(identity)!, tileType: 'profile', isLocal: false,
  isSpeaking: false, isScreenAudioActive: false, muted: false, deafened: false, sharingScreen: false, sharingCamera: false, hasVisual: false, priority,
}) as VoiceMediaTile)
const members = people.map(([userIdentity, displayName]) => ({
  serverId: 1, userIdentity, role: 'Member', joinedAt: '', timeoutUntil: null,
  user: { identity: userIdentity, username: userIdentity, displayName },
}) as ServerMemberWithUser)
const noop = () => undefined

export function Fixture() {
  return <main className="mx-auto max-w-xl space-y-6 p-4 sm:p-8">
    <h1 className="text-xl font-semibold">Call volume verification</h1>
    <p className="text-sm text-muted-foreground">No backend or audio capture. Changes use isolated in-memory storage.</p>
    <div className="flex flex-wrap gap-2">
      <CallVolumeMixer />
    </div>
    {[false, true].map(compact => <div key={String(compact)} className="flex items-center gap-2 rounded-xl border p-3">
      <span className="mr-auto text-sm">{compact ? 'Sidebar' : 'Call dock'}</span>
      <CallLatencyBadge room={room} compact={compact} />
      <NoiseFilterToggle compact={compact} />
      <CallVolumeMixer compact className={compact ? 'size-8 rounded-md' : 'size-9 rounded-md'} />
    </div>)}
    <section className="space-y-2">
      <h2 className="font-medium">Right-click a person</h2>
      <div className="w-72"><VoiceChannelButton channel={{ id: 1, name: 'General' } as Channel} active participants={useVoiceStore.getState().participantsByChannel[1]}
        connectionStatus="Connected" activeSpeakerIdentityKeys={new Set()} muted={false} onToggleMute={noop} onSelect={() => { document.title = 'selected' }}
        memberProfileByIdentity={new Map(people.map(([identity, label]) => [identity, { label, avatarUrl: null }]))} /></div>
      <div className="flex h-64"><VoiceMediaStage tiles={tiles} /></div>
      <div className="h-64"><MemberPanel members={members} selfIdentity="self" selfRole="Member" serverId={1}
        onKick={noop} onBan={noop} onTimeout={noop} onRemoveTimeout={noop} onSetRole={noop} onTransferOwnership={noop} /></div>
    </section>
    <AudioTab />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
