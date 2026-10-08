import { useNavigate } from 'react-router-dom'
import { PhoneCallIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CompactBack } from '../../components/CompactBack'
import { useIsMobile } from '../../hooks/use-mobile'
import { useChannelsStore } from '../../stores/channelsStore'
import { useMembersStore } from '../../stores/membersStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { isCallCancelled, joinLiveKitVoice } from '../../lib/livekit'
import type { u64 } from '../../types/domain'
import { useActiveCall } from './hooks/useActiveCall'
import { CallPanel } from './components/CallPanel'
import { VoiceMediaStage } from './components/VoiceMediaStage'
import { buildVoiceMediaTiles } from './mediaTiles'
import { toast } from 'sonner'

export function VoiceChannelView({ channelId }: { channelId: u64 | null }) {
  const call = useActiveCall()
  const navigate = useNavigate()
  const compact = useIsMobile()
  const channels = useChannelsStore((s) => s.channelsByServer)
  const members = useMembersStore((s) => s.membersByServer)
  const participants = useVoiceStore((s) => s.participantsByChannel)
  const channel = Object.values(channels).flat().find((item) => item.id === channelId)
  const returnTo = channel ? `/app/${channel.serverId}/channels` : '/app/spaces'
  if (channelId !== null && call.channelId === channelId) return <CallPanel call={call} onBack={() => navigate(returnTo)} />
  const profiles = Object.values(members).flat()
  const tiles = buildVoiceMediaTiles({
    participants: channelId !== null ? participants[channelId] ?? [] : [], selfIdentity: null,
    localParticipant: null, livekitParticipantByIdentity: new Map(), normalizedActiveSpeakers: new Set(),
    displayNameByIdentity: new Map(profiles.map((member) => [member.userIdentity.trim().toLowerCase(), member.user?.displayName || member.user?.username || member.userIdentity.slice(0, 12)])),
    avatarByIdentity: new Map(profiles.map((member) => [member.userIdentity.trim().toLowerCase(), member.user?.avatarUrl ?? null])),
  })
  const onJoin = async () => {
    if (channelId === null) return
    try {
      const joining = joinLiveKitVoice(channelId)
      if (compact) navigate('/app/call', { state: { returnTo } })
      await joining
    } catch (error) {
      if (!isCallCancelled(error)) toast.error(error instanceof Error ? error.message : 'Could not join call.')
    }
  }
  return <section className="flex h-full min-h-0 flex-col gap-2 p-2 sm:p-3">
    <header className="flex shrink-0 items-center gap-2"><CompactBack /><h2 className="min-w-0 truncate font-semibold">{channel?.name ?? 'Voice channel'}</h2></header>
    <VoiceMediaStage tiles={tiles} emptyStateText="No one is here yet" />
    <div className="shrink-0 border-t pt-2"><Button className="h-12 w-full sm:w-auto" disabled={channelId === null} onClick={() => void onJoin()}><PhoneCallIcon />Join call</Button></div>
  </section>
}
