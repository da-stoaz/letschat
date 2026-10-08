import { useEffect, useMemo } from 'react'
import { ConnectionState, type LocalParticipant, type RemoteParticipant } from 'livekit-client'
import { dmVoiceRoomKey, leaveLiveKitDmVoice, leaveLiveKitVoice, supportsScreenCapture, useLiveKitRoom } from '../../../lib/livekit'
import { reducers } from '../../../lib/spacetimedb'
import { useConnectionStore } from '../../../stores/connectionStore'
import { useVoiceSessionStore } from '../../../stores/voiceSessionStore'
import { useDmVoiceSessionStore } from '../../../stores/dmVoiceSessionStore'
import { useVoiceStore } from '../../../stores/voiceStore'
import { useDmVoiceStore } from '../../../stores/dmVoiceStore'
import { useChannelsStore } from '../../../stores/channelsStore'
import { useUsersStore } from '../../../stores/usersStore'
import { useMembersStore } from '../../../stores/membersStore'
import { useMediaDeviceStore } from '../../../stores/mediaDeviceStore'
import { buildVoiceMediaTiles } from '../mediaTiles'
import { encodeDmSystemMessage, getCallDurationSeconds } from '../../dm/systemMessages'
import { useVoiceControlActions } from './useVoiceControlActions'
import { useOngoingCallDuration } from './useOngoingCallDuration'
import type { Channel, Identity, VoiceParticipant, DmVoiceParticipant } from '../../../types/domain'

const EMPTY: (VoiceParticipant | DmVoiceParticipant)[] = []
const key = (identity: string) => identity.trim().toLowerCase()

export function callDetails(channel: Channel | undefined, partnerIdentity: Identity | null, displayName: string | undefined) {
  if (partnerIdentity) return { title: displayName ?? 'Direct call', returnPath: `/app/dm/${partnerIdentity}`, conversationPath: `/app/dm/${partnerIdentity}` }
  if (channel) return { title: channel.name, returnPath: `/app/${channel.serverId}/channels`, conversationPath: `/app/${channel.serverId}/${channel.id}` }
  return { title: 'Voice call', returnPath: '/app/messages', conversationPath: null }
}

export function callStatus(connecting: boolean, state: ConnectionState, joined: boolean, calling: boolean) {
  if (connecting) return 'Connecting…'
  if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) return 'Reconnecting…'
  if (!joined) return 'Call ended'
  return calling ? 'Calling…' : 'Connected'
}

function useCallSession() {
  const voice = useVoiceSessionStore()
  const dm = useDmVoiceSessionStore()
  const selfIdentity = useConnectionStore((s) => s.identity)
  const channels = useChannelsStore((s) => s.channelsByServer)
  const voiceParticipants = useVoiceStore((s) => s.participantsByChannel)
  const dmParticipants = useDmVoiceStore((s) => s.participantsByRoom)
  const channelId = voice.joinedChannelId
  const partnerIdentity = dm.joinedPartnerIdentity
  const channel = Object.values(channels).flat().find((item) => item.id === channelId)
  const isDm = partnerIdentity !== null
  const session = isDm ? dm : voice
  const active = channelId !== null || partnerIdentity !== null
  const roomKey = selfIdentity && partnerIdentity ? dmVoiceRoomKey(selfIdentity, partnerIdentity) : null
  const participants = isDm
    ? (roomKey ? dmParticipants[roomKey] ?? EMPTY : EMPTY)
    : (channelId !== null ? voiceParticipants[channelId] ?? EMPTY : EMPTY)
  const self = participants.find((p) => key(p.userIdentity) === key(selfIdentity ?? '')) ?? null
  return { session, dm, channelId, partnerIdentity, channel, isDm, active, participants, selfIdentity, self }
}

// Presentation observes the session; mounting or minimizing a view never owns it.
export function useActiveCall() {
  const { session, dm, channelId, partnerIdentity, channel, isDm, active, participants, selfIdentity, self } = useCallSession()
  const { room, setError } = session
  const users = useUsersStore((s) => s.byIdentity)
  const members = useMembersStore((s) => s.membersByServer)
  const audioInputId = useMediaDeviceStore((s) => s.audioInputId)
  const videoInputId = useMediaDeviceStore((s) => s.videoInputId)
  const setAnswered = dm.setAnswered
  const { localParticipant, remoteParticipants, activeSpeakerIds, connectionState } = useLiveKitRoom(room)
  const joined = room !== null && connectionState === ConnectionState.Connected
  const connecting = session.joining || (room !== null && connectionState === ConnectionState.Connecting)
  const hasScreenCapture = supportsScreenCapture()
  const muted = self?.muted ?? !room?.localParticipant.isMicrophoneEnabled
  const deafened = self?.deafened ?? false
  const sharingCamera = self?.sharingCamera ?? false
  const sharingScreen = self?.sharingScreen ?? false

  useEffect(() => {
    if (!joined) return
    for (const participant of remoteParticipants) participant.setVolume(deafened ? 0 : 1)
    if (isDm && remoteParticipants.length > 0) setAnswered(true)
  }, [joined, deafened, remoteParticipants, isDm, setAnswered])

  const actions = useVoiceControlActions({
    room, remoteParticipants, selfState: self,
    audioInputId, videoInputId, hasScreenCapture, setError,
    patchVoiceState: async (patch) => {
      if (!self) return
      const next = { ...self, ...patch }
      if (partnerIdentity) {
        await reducers.updateDmVoiceState(partnerIdentity, next.muted, next.deafened, next.sharingScreen, next.sharingCamera)
      } else if (channelId !== null) {
        await reducers.updateVoiceState(channelId, next.muted, next.deafened, next.sharingScreen, next.sharingCamera)
      }
    },
    onLeaveRoom: async () => {
      if (partnerIdentity) {
        const durationSeconds = getCallDurationSeconds(self?.joinedAt)
        await leaveLiveKitDmVoice(partnerIdentity, room)
        if (durationSeconds !== null) {
          await reducers.sendDirectMessage(partnerIdentity, encodeDmSystemMessage('call_ended', {
            durationSeconds, missed: !dm.answered,
          })).catch(() => undefined)
        }
      } else if (channelId !== null) {
        await leaveLiveKitVoice(channelId, room)
      }
    },
    leaveErrorMessage: 'Could not end call.',
  })

  const names = useMemo(() => {
    const all = [...Object.values(members).flat().flatMap((member) => member.user ? [member.user] : []), ...Object.values(users)]
    return {
      displayNameByIdentity: new Map(all.map((user) => [key(user.identity), user.displayName || user.username])),
      avatarByIdentity: new Map(all.map((user) => [key(user.identity), user.avatarUrl ?? null])),
    }
  }, [members, users])
  const tiles = useMemo(() => {
    const livekitParticipantByIdentity = new Map<string, LocalParticipant | RemoteParticipant>()
    for (const participant of [localParticipant, ...remoteParticipants]) {
      if (participant) livekitParticipantByIdentity.set(key(participant.identity), participant)
    }
    return buildVoiceMediaTiles({
      participants, selfIdentity, localParticipant, livekitParticipantByIdentity,
      normalizedActiveSpeakers: new Set(Array.from(activeSpeakerIds).map(key)), ...names,
    })
  }, [participants, selfIdentity, localParticipant, remoteParticipants, activeSpeakerIds, names])
  const duration = useOngoingCallDuration(self?.joinedAt ?? null, joined)
  return {
    active, channelId, partnerIdentity, room, joined, connecting, muted, deafened, sharingCamera, sharingScreen,
    hasScreenCapture, tiles, participants, duration, setError, error: session.error ?? (!active ? dm.error : null),
    ...callDetails(channel, partnerIdentity, names.displayNameByIdentity.get(key(partnerIdentity ?? ''))),
    status: callStatus(connecting, connectionState, joined, isDm && !dm.answered),
    ...actions,
  }
}

export type ActiveCall = ReturnType<typeof useActiveCall>
