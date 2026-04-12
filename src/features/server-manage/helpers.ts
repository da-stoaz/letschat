import type { Channel, ServerInvitePolicy } from '../../types/domain'
import type { ServerMemberWithUser } from '../../stores/membersStore'

export function memberLabel(member: ServerMemberWithUser): string {
  return member.user?.displayName || member.user?.username || member.userIdentity.slice(0, 12)
}

export function memberUsername(member: ServerMemberWithUser): string {
  return member.user?.username || member.userIdentity.slice(0, 12)
}

export function formatMemberSince(joinedAt: string): string {
  const date = new Date(joinedAt)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function hasActiveTimeout(member: ServerMemberWithUser): boolean {
  if (!member.timeoutUntil) return false
  return Date.parse(member.timeoutUntil) > Date.now()
}

export function invitePolicyLabel(policy: ServerInvitePolicy): string {
  return policy === 'Everyone' ? 'Everyone (all members)' : 'Owner + Moderators'
}

export function sectionLabel(section: string | null): string {
  const normalized = section?.trim()
  return normalized && normalized.length > 0 ? normalized : 'general'
}

export function sectionKey(section: string | null): string {
  return (section ?? '').trim()
}

export function channelGroupKey(channel: Channel): string {
  return sectionKey(channel.section)
}

export function roleBadgeClassName(role: ServerMemberWithUser['role']): string {
  if (role === 'Owner') return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
  if (role === 'Moderator') return 'bg-blue-500/15 text-blue-300 border-blue-500/30'
  return ''
}
