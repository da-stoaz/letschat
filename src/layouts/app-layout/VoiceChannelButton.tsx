import { LockIcon, Volume2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@/components/ui/avatar'
import { normalizeIdentity, userInitials } from './helpers'
import type { Channel, VoiceParticipant } from '../../types/domain'

interface VoiceChannelButtonProps {
  channel: Channel
  active: boolean
  participants: VoiceParticipant[]
  normalizedSelfIdentity: string | null
  memberProfileByIdentity: Map<string, { label: string; avatarUrl: string | null }>
  onSelect: () => void
}

export function VoiceChannelButton({
  channel,
  active,
  participants,
  normalizedSelfIdentity,
  memberProfileByIdentity,
  onSelect,
}: VoiceChannelButtonProps) {
  const previewParticipants = participants.slice(0, 4)
  const overflow = Math.max(0, participants.length - previewParticipants.length)
  const selfJoined =
    normalizedSelfIdentity !== null &&
    participants.some((participant) => normalizeIdentity(participant.userIdentity) === normalizedSelfIdentity)

  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      className="h-auto w-full items-start justify-start gap-2 rounded-lg py-2"
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
                  const isSelf =
                    normalizedSelfIdentity !== null &&
                    normalizeIdentity(participant.userIdentity) === normalizedSelfIdentity
                  return (
                    <Avatar
                      key={`${channel.id}-${participant.userIdentity}`}
                      size="sm"
                      className={isSelf ? 'ring-2 ring-emerald-400' : undefined}
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
  )
}
