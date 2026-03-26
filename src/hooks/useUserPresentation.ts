import { useMemo } from 'react'
import { useConnectionStore } from '../stores/connectionStore'
import { useDmVoiceStore } from '../stores/dmVoiceStore'
import { useMembersStore } from '../stores/membersStore'
import { usePresenceStore } from '../stores/presenceStore'
import { useUsersStore } from '../stores/usersStore'
import { useVoiceStore } from '../stores/voiceStore'
import type { Identity } from '../types/domain'

export type UserPresenceStatus = 'online' | 'away' | 'offline'

export interface UserPresentation {
  identity: Identity
  displayName: string
  username: string
  avatarUrl: string | null
  status: UserPresenceStatus
}

const AWAY_AFTER_MS = 3 * 60 * 1000
const CONNECTED_STALE_MS = 75 * 1000

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase()
}

function resolveUser(identity: Identity, usersByIdentity: Record<string, { displayName: string; username: string; avatarUrl: string | null }>) {
  const exact = usersByIdentity[identity]
  if (exact) return exact
  const normalized = normalizeIdentity(identity)
  for (const [key, user] of Object.entries(usersByIdentity)) {
    if (normalizeIdentity(key) === normalized) return user
  }
  return null
}

export function useUserPresentation(identity: Identity): UserPresentation {
  const usersByIdentity = useUsersStore((s) => s.byIdentity)
  const membersByServer = useMembersStore((s) => s.membersByServer)
  const connectionStatus = useConnectionStore((s) => s.status)
  const selfIdentity = useConnectionStore((s) => s.identity)
  const nowMs = usePresenceStore((s) => s.nowMs)
  const lastSeenByIdentity = usePresenceStore((s) => s.lastSeenByIdentity)
  const lastActiveByIdentity = usePresenceStore((s) => s.lastActiveByIdentity)
  const voiceParticipantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const dmVoiceParticipantsByRoom = useDmVoiceStore((s) => s.participantsByRoom)

  return useMemo(() => {
    const normalized = normalizeIdentity(identity)

    const directUser = resolveUser(identity, usersByIdentity)
    let displayName = directUser?.displayName || directUser?.username || identity.slice(0, 12)
    let username = directUser?.username || identity.slice(0, 12)
    let avatarUrl = directUser?.avatarUrl ?? null

    if (!directUser) {
      for (const serverMembers of Object.values(membersByServer)) {
        const match = serverMembers.find((member) => normalizeIdentity(member.userIdentity) === normalized)
        if (match) {
          displayName = match.user?.displayName || match.user?.username || displayName
          username = match.user?.username || username
          avatarUrl = match.user?.avatarUrl ?? avatarUrl
          break
        }
      }
    }

    const isSelf = selfIdentity ? normalizeIdentity(selfIdentity) === normalized : false
    const lastSeenAt = lastSeenByIdentity[normalized] ?? 0
    const lastActiveAt = lastActiveByIdentity[normalized] ?? lastSeenAt

    const inVoicePresence = Object.values(voiceParticipantsByChannel).some((participants) =>
      participants.some((participant) => normalizeIdentity(participant.userIdentity) === normalized),
    )
    const inDmVoicePresence = Object.values(dmVoiceParticipantsByRoom).some((participants) =>
      participants.some((participant) => normalizeIdentity(participant.userIdentity) === normalized),
    )
    const currentlyPresent = inVoicePresence || inDmVoicePresence

    const seenRecently = lastSeenAt > 0 && nowMs - lastSeenAt <= CONNECTED_STALE_MS
    const connected = isSelf ? connectionStatus === 'connected' : currentlyPresent || seenRecently

    let status: UserPresenceStatus = 'offline'
    if (connected) {
      status = nowMs - lastActiveAt > AWAY_AFTER_MS ? 'away' : 'online'
    }

    return {
      identity,
      displayName,
      username,
      avatarUrl,
      status,
    }
  }, [
    connectionStatus,
    dmVoiceParticipantsByRoom,
    identity,
    lastActiveByIdentity,
    lastSeenByIdentity,
    membersByServer,
    nowMs,
    selfIdentity,
    usersByIdentity,
    voiceParticipantsByChannel,
  ])
}
