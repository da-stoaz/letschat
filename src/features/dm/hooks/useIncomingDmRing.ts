import { useEffect, useMemo, useRef } from 'react'
import { toast } from '@/components/ui/sonner'
import { tauriCommands } from '../../../lib/tauri'
import type { DmVoiceParticipant, Identity, User } from '../../../types/domain'

function normalizeIdentity(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().toLowerCase()
}

function sameIdentity(left: string | null | undefined, right: string | null | undefined): boolean {
  return normalizeIdentity(left) !== '' && normalizeIdentity(left) === normalizeIdentity(right)
}

type IncomingDmCall = {
  roomKey: string
  callerIdentity: Identity
  partnerIdentity: Identity
  callerLabel: string
}

type RingingState = {
  roomKey: string
  stopTone: (() => void) | null
  toastId: string | number | null
  timeoutId: number | null
}

function startRingtoneLoop(): () => void {
  if (typeof window === 'undefined') return () => undefined
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return () => undefined

  const audioContext = new AudioContextCtor()
  let stopped = false
  let timerId: number | null = null

  const playBurst = () => {
    if (stopped) return
    const envelope = audioContext.createGain()
    envelope.connect(audioContext.destination)
    envelope.gain.setValueAtTime(0.0001, audioContext.currentTime)

    const toneA = audioContext.createOscillator()
    toneA.type = 'sine'
    toneA.frequency.setValueAtTime(740, audioContext.currentTime)
    toneA.connect(envelope)
    toneA.start(audioContext.currentTime)
    envelope.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02)
    envelope.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.34)
    toneA.stop(audioContext.currentTime + 0.35)

    const toneB = audioContext.createOscillator()
    toneB.type = 'sine'
    toneB.frequency.setValueAtTime(740, audioContext.currentTime + 0.45)
    toneB.connect(envelope)
    toneB.start(audioContext.currentTime + 0.45)
    envelope.gain.setValueAtTime(0.0001, audioContext.currentTime + 0.44)
    envelope.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.47)
    envelope.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.79)
    toneB.stop(audioContext.currentTime + 0.8)

    timerId = window.setTimeout(playBurst, 1850)
  }

  void audioContext.resume().catch(() => undefined)
  playBurst()

  return () => {
    stopped = true
    if (timerId !== null) {
      window.clearTimeout(timerId)
    }
    void audioContext.close().catch(() => undefined)
  }
}

function findIncomingDmCall(
  participantsByRoom: Record<string, DmVoiceParticipant[]>,
  selfIdentity: Identity | null,
  usersByIdentity: Record<Identity, User>,
): IncomingDmCall | null {
  if (!selfIdentity) return null

  for (const [roomKey, rows] of Object.entries(participantsByRoom)) {
    if (rows.length !== 1) continue

    const caller = rows[0]
    if (sameIdentity(caller.userIdentity, selfIdentity)) continue

    const roomIncludesSelf = sameIdentity(caller.userA, selfIdentity) || sameIdentity(caller.userB, selfIdentity)
    if (!roomIncludesSelf) continue

    const partnerIdentity = sameIdentity(caller.userA, selfIdentity) ? caller.userB : caller.userA

    const knownUser = Object.values(usersByIdentity).find((user) => sameIdentity(user.identity, caller.userIdentity))
    const callerLabel = knownUser?.displayName || knownUser?.username || caller.userIdentity.slice(0, 12)

    return {
      roomKey,
      callerIdentity: caller.userIdentity,
      partnerIdentity,
      callerLabel,
    }
  }

  return null
}

export function useIncomingDmRing({
  participantsByRoom,
  usersByIdentity,
  selfIdentity,
  activeDmIdentity,
  joinedDmPartnerIdentity,
  dmJoining,
  onOpenDm,
}: {
  participantsByRoom: Record<string, DmVoiceParticipant[]>
  usersByIdentity: Record<Identity, User>
  selfIdentity: Identity | null
  activeDmIdentity: Identity | null
  joinedDmPartnerIdentity: Identity | null
  dmJoining: boolean
  onOpenDm: (identity: Identity) => void
}) {
  const incoming = useMemo(
    () => findIncomingDmCall(participantsByRoom, selfIdentity, usersByIdentity),
    [participantsByRoom, selfIdentity, usersByIdentity],
  )

  const ringingRef = useRef<RingingState | null>(null)

  useEffect(() => {
    const shouldSilenceForActiveConversation =
      incoming !== null && (sameIdentity(activeDmIdentity, incoming.partnerIdentity) || sameIdentity(joinedDmPartnerIdentity, incoming.partnerIdentity) || dmJoining)

    if (incoming === null || shouldSilenceForActiveConversation) {
      const previous = ringingRef.current
      if (previous) {
        previous.stopTone?.()
        if (previous.timeoutId !== null) {
          window.clearTimeout(previous.timeoutId)
        }
        if (previous.toastId !== null) {
          toast.dismiss(previous.toastId)
        }
      }
      ringingRef.current = null
      return
    }

    if (ringingRef.current?.roomKey === incoming.roomKey) {
      return
    }

    const previous = ringingRef.current
    if (previous) {
      previous.stopTone?.()
      if (previous.timeoutId !== null) {
        window.clearTimeout(previous.timeoutId)
      }
      if (previous.toastId !== null) {
        toast.dismiss(previous.toastId)
      }
    }

    const stopTone = startRingtoneLoop()
    void tauriCommands
      .showNotification('Incoming DM call', `${incoming.callerLabel} is calling you`)
      .catch(() => undefined)

    const toastId = toast('Incoming DM call', {
      description: `${incoming.callerLabel} is calling you`,
      duration: Infinity,
      action: {
        label: 'Open',
        onClick: () => onOpenDm(incoming.partnerIdentity),
      },
      cancel: {
        label: 'Dismiss',
        onClick: () => {
          const state = ringingRef.current
          state?.stopTone?.()
          if (state?.timeoutId !== null && state?.timeoutId !== undefined) {
            window.clearTimeout(state.timeoutId)
          }
          ringingRef.current = null
        },
      },
    })

    const timeoutId = window.setTimeout(() => {
      const state = ringingRef.current
      if (!state || state.roomKey !== incoming.roomKey) return
      state.stopTone?.()
      toast.dismiss(toastId)
      ringingRef.current = null
    }, 30_000)

    ringingRef.current = {
      roomKey: incoming.roomKey,
      stopTone,
      toastId,
      timeoutId,
    }
  }, [activeDmIdentity, dmJoining, incoming, joinedDmPartnerIdentity, onOpenDm])
}
