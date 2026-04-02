import { BellIcon, BellOffIcon, LockIcon, Volume2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@/components/ui/avatar'
import { normalizeIdentity, userInitials } from './helpers'
import { cn } from '../../lib/utils'
import type { Channel, VoiceParticipant } from '../../types/domain'

interface VoiceChannelButtonProps {
  channel: Channel
  active: boolean
  participants: VoiceParticipant[]
  selfJoined: boolean
  activeSpeakerIdentityKeys: Set<string>
  muted: boolean
  memberProfileByIdentity: Map<string, { label: string; avatarUrl: string | null }>
  onToggleMute: () => void
  onSelect: () => void
}

export function VoiceChannelButton({
  channel,
  active,
  participants,
  selfJoined,
  activeSpeakerIdentityKeys,
  muted,
  memberProfileByIdentity,
  onToggleMute,
  onSelect,
}: VoiceChannelButtonProps) {
  const previewParticipants = participants.slice(0, 4)
  const overflow = Math.max(0, participants.length - previewParticipants.length)

  return (
    <div className="flex items-start gap-1">
      <Button
        variant={active ? 'secondary' : 'ghost'}
        className="h-auto min-w-0 flex-1 items-start justify-start gap-2 rounded-lg py-2"
        onClick={onSelect}
      >
        <Volume2Icon className="mt-0.5 size-4 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="truncate">{channel.name}</span>
            {selfJoined ? (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                Joined
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {participants.length > 0 ? (
              <>
                <AvatarGroup>
                  {previewParticipants.map((participant) => {
                    const profile = memberProfileByIdentity.get(normalizeIdentity(participant.userIdentity))
                    const fallbackLabel = profile?.label ?? participant.userIdentity.slice(0, 10)
                    const normalizedParticipantIdentity = normalizeIdentity(participant.userIdentity)
                    const isSpeaking = activeSpeakerIdentityKeys.has(normalizedParticipantIdentity)
                    return (
                      <Avatar
                        key={`${channel.id}-${participant.userIdentity}`}
                        size="sm"
                        className={cn(
                          isSpeaking
                            ? 'after:border-2 after:border-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,0.35)]'
                            : undefined,
                        )}
                      >
                        {profile?.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={fallbackLabel} /> : null}
                        <AvatarFallback>{userInitials(fallbackLabel)}</AvatarFallback>
                      </Avatar>
                    )
                  })}
                  {overflow > 0 ? <AvatarGroupCount className="size-6 text-[10px]">+{overflow}</AvatarGroupCount> : null}
                </AvatarGroup>
                <span className="text-[11px] text-muted-foreground">{participants.length}/15</span>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">No one connected</span>
            )}
          </div>
        </div>
        {channel.moderatorOnly ? <LockIcon className="mt-0.5 size-3.5 shrink-0 opacity-70" /> : null}
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant={muted ? 'secondary' : 'ghost'}
        aria-label={muted ? 'Unmute channel' : 'Mute channel'}
        title={muted ? 'Unmute channel' : 'Mute channel'}
        className="mt-1 shrink-0"
        onClick={(event) => {
          event.stopPropagation()
          onToggleMute()
        }}
      >
        {muted ? <BellOffIcon className="size-3.5" /> : <BellIcon className="size-3.5" />}
      </Button>
    </div>
  )
}
