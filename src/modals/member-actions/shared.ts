import type { ServerMemberWithUser } from '../../stores/membersStore'

export interface MemberActionModalProps {
  serverId: number
  member: ServerMemberWithUser
  onClose: () => void
}

export function memberLabel(member: ServerMemberWithUser): string {
  return member.user?.displayName ?? member.user?.username ?? member.userIdentity.slice(0, 12)
}

export function memberUsername(member: ServerMemberWithUser): string {
  return member.user?.username ?? member.userIdentity.slice(0, 12)
}

