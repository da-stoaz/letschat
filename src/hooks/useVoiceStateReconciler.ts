import { useEffect, useMemo, useRef } from 'react'
import { reducers } from '../lib/spacetimedb'
import { useConnectionStore } from '../stores/connectionStore'
import { useDmVoiceSessionStore } from '../stores/dmVoiceSessionStore'
import { useDmVoiceStore } from '../stores/dmVoiceStore'
import { useVoiceSessionStore } from '../stores/voiceSessionStore'
import { useVoiceStore } from '../stores/voiceStore'

function normalizeIdentity(identity: string | null | undefined): string {
  if (!identity) return ''
  return identity.trim().toLowerCase()
}

type VoiceSelfPresence = {
  channelId: number
  joinedAt: string
}

type DmSelfPresence = {
  partnerIdentity: string
  roomKey: string
  joinedAt: string
}

export function useVoiceStateReconciler(): void {
  const connectionStatus = useConnectionStore((state) => state.status)
  const selfIdentity = useConnectionStore((state) => state.identity)

  const voiceRoom = useVoiceSessionStore((state) => state.room)
  const joinedVoiceChannelId = useVoiceSessionStore((state) => state.joinedChannelId)
  const voiceJoining = useVoiceSessionStore((state) => state.joining)

  const dmRoom = useDmVoiceSessionStore((state) => state.room)
  const joinedDmPartnerIdentity = useDmVoiceSessionStore((state) => state.joinedPartnerIdentity)
  const dmJoining = useDmVoiceSessionStore((state) => state.joining)

  const participantsByChannel = useVoiceStore((state) => state.participantsByChannel)
  const participantsByRoom = useDmVoiceStore((state) => state.participantsByRoom)

  const inFlightVoiceLeaves = useRef<Set<number>>(new Set())
  const inFlightDmLeaves = useRef<Set<string>>(new Set())

  const selfVoicePresences = useMemo<VoiceSelfPresence[]>(() => {
    const normalizedSelf = normalizeIdentity(selfIdentity)
    if (!normalizedSelf) return []

    const rows: VoiceSelfPresence[] = []
    for (const [channelIdRaw, participants] of Object.entries(participantsByChannel)) {
      const selfParticipant = participants.find(
        (participant) => normalizeIdentity(participant.userIdentity) === normalizedSelf,
      )
      if (!selfParticipant) continue
      rows.push({ channelId: Number(channelIdRaw), joinedAt: selfParticipant.joinedAt })
    }
    return rows
  }, [participantsByChannel, selfIdentity])

  const selfDmPresences = useMemo<DmSelfPresence[]>(() => {
    const normalizedSelf = normalizeIdentity(selfIdentity)
    if (!normalizedSelf) return []

    const rows: DmSelfPresence[] = []
    for (const [roomKey, participants] of Object.entries(participantsByRoom)) {
      const selfParticipant = participants.find(
        (participant) => normalizeIdentity(participant.userIdentity) === normalizedSelf,
      )
      if (!selfParticipant) continue

      const userA = normalizeIdentity(selfParticipant.userA)
      const partnerIdentity = userA === normalizedSelf ? selfParticipant.userB : selfParticipant.userA
      rows.push({ roomKey, partnerIdentity, joinedAt: selfParticipant.joinedAt })
    }
    return rows
  }, [participantsByRoom, selfIdentity])

  useEffect(() => {
    if (connectionStatus !== 'connected') return
    if (!selfIdentity) return
    if (voiceJoining) return

    const activeChannelId = joinedVoiceChannelId
    const hasActiveServerSession = voiceRoom !== null && activeChannelId !== null

    for (const presence of selfVoicePresences) {
      const isActivePresence = hasActiveServerSession && presence.channelId === activeChannelId
      if (isActivePresence) continue
      if (inFlightVoiceLeaves.current.has(presence.channelId)) continue

      inFlightVoiceLeaves.current.add(presence.channelId)
      void reducers
        .leaveVoiceChannel(presence.channelId)
        .catch(() => undefined)
        .finally(() => {
          inFlightVoiceLeaves.current.delete(presence.channelId)
        })
    }
  }, [
    connectionStatus,
    selfIdentity,
    voiceJoining,
    voiceRoom,
    joinedVoiceChannelId,
    selfVoicePresences,
  ])

  useEffect(() => {
    if (connectionStatus !== 'connected') return
    if (!selfIdentity) return
    if (dmJoining) return

    const normalizedJoinedPartner = normalizeIdentity(joinedDmPartnerIdentity)
    const hasActiveDmSession = dmRoom !== null && normalizedJoinedPartner.length > 0

    for (const presence of selfDmPresences) {
      const presenceKey = `${normalizeIdentity(presence.partnerIdentity)}:${presence.joinedAt}`
      const isActivePresence =
        hasActiveDmSession &&
        normalizeIdentity(presence.partnerIdentity) === normalizedJoinedPartner
      if (isActivePresence) continue
      if (inFlightDmLeaves.current.has(presenceKey)) continue

      inFlightDmLeaves.current.add(presenceKey)
      void reducers
        .leaveDmVoice(presence.partnerIdentity)
        .catch(() => undefined)
        .finally(() => {
          inFlightDmLeaves.current.delete(presenceKey)
        })
    }
  }, [
    connectionStatus,
    selfIdentity,
    dmJoining,
    dmRoom,
    joinedDmPartnerIdentity,
    selfDmPresences,
  ])
}
