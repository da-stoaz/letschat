import { useEffect, useMemo, useState } from 'react'
import { ConnectionState } from 'livekit-client'
import {
  AudioLinesIcon,
  LogOutIcon,
  MicIcon,
  MicOffIcon,
  MonitorUpIcon,
  VideoIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import {
  dmVoiceRoomKey,
  getCameraErrorMessage,
  getMicrophoneUnavailableReason,
  leaveLiveKitDmVoice,
  leaveLiveKitVoice,
  listLivekitDevices,
  requestMicrophonePermission,
  setLocalCameraEnabled,
  supportsMicrophoneCapture,
  supportsScreenCapture,
  switchRoomDevice,
  useLiveKitRoom,
  type LivekitDeviceOption,
} from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { useChannelsStore } from '../../stores/channelsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useDmVoiceSessionStore } from '../../stores/dmVoiceSessionStore'
import { useDmVoiceStore } from '../../stores/dmVoiceStore'
import { useMediaDeviceStore } from '../../stores/mediaDeviceStore'
import { useServersStore } from '../../stores/serversStore'
import { useUsersStore } from '../../stores/usersStore'
import { useVoiceSessionStore } from '../../stores/voiceSessionStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { normalizeIdentity } from './helpers'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const EMPTY_VOICE_PARTICIPANTS: Array<{
  userIdentity: string
  muted: boolean
  deafened: boolean
  sharingCamera: boolean
  sharingScreen: boolean
}> = []

type CallMode = 'server' | 'dm'

function getStatusLabel(connected: boolean, connecting: boolean): string {
  if (connecting) return 'Connecting'
  return connected ? 'Connected' : 'Not connected'
}

function selectInitialDevice(
  explicitDeviceId: string | null,
  activeDeviceId: string | undefined,
  options: LivekitDeviceOption[],
): string | null {
  if (explicitDeviceId && options.some((device) => device.deviceId === explicitDeviceId)) {
    return explicitDeviceId
  }
  if (activeDeviceId && options.some((device) => device.deviceId === activeDeviceId)) {
    return activeDeviceId
  }
  return options[0]?.deviceId ?? null
}

export function ActiveCallCard() {
  const selfIdentity = useConnectionStore((s) => s.identity)
  const voiceRoom = useVoiceSessionStore((s) => s.room)
  const joinedVoiceChannelId = useVoiceSessionStore((s) => s.joinedChannelId)
  const voiceJoining = useVoiceSessionStore((s) => s.joining)
  const setVoiceRoom = useVoiceSessionStore((s) => s.setRoom)
  const setJoinedVoiceChannelId = useVoiceSessionStore((s) => s.setJoinedChannelId)
  const setVoiceJoining = useVoiceSessionStore((s) => s.setJoining)
  const setVoiceError = useVoiceSessionStore((s) => s.setError)

  const dmRoom = useDmVoiceSessionStore((s) => s.room)
  const joinedDmPartnerIdentity = useDmVoiceSessionStore((s) => s.joinedPartnerIdentity)
  const dmJoining = useDmVoiceSessionStore((s) => s.joining)
  const setDmRoom = useDmVoiceSessionStore((s) => s.setRoom)
  const setJoinedDmPartnerIdentity = useDmVoiceSessionStore((s) => s.setJoinedPartnerIdentity)
  const setDmJoining = useDmVoiceSessionStore((s) => s.setJoining)
  const setDmError = useDmVoiceSessionStore((s) => s.setError)

  const participantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const participantsByDmRoom = useDmVoiceStore((s) => s.participantsByRoom)
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const servers = useServersStore((s) => s.servers)
  const usersByIdentity = useUsersStore((s) => s.byIdentity)

  const audioInputId = useMediaDeviceStore((s) => s.audioInputId)
  const audioOutputId = useMediaDeviceStore((s) => s.audioOutputId)
  const videoInputId = useMediaDeviceStore((s) => s.videoInputId)
  const setAudioInputId = useMediaDeviceStore((s) => s.setAudioInputId)
  const setAudioOutputId = useMediaDeviceStore((s) => s.setAudioOutputId)
  const setVideoInputId = useMediaDeviceStore((s) => s.setVideoInputId)

  const hasServerSession = Boolean(voiceRoom || joinedVoiceChannelId !== null || voiceJoining)
  const hasDmSession = Boolean(dmRoom || joinedDmPartnerIdentity || dmJoining)
  const mode: CallMode | null = hasServerSession ? 'server' : hasDmSession ? 'dm' : null

  const activeRoom = mode === 'server' ? voiceRoom : mode === 'dm' ? dmRoom : null
  const { activeSpeakerIds, connectionState, remoteParticipants } = useLiveKitRoom(activeRoom)

  const serverChannelById = useMemo(() => {
    const map = new Map<number, { channelName: string; serverName: string }>()
    for (const [serverIdRaw, channels] of Object.entries(channelsByServer)) {
      const serverId = Number(serverIdRaw)
      const server = servers.find((item) => item.id === serverId)
      for (const channel of channels ?? []) {
        map.set(channel.id, {
          channelName: channel.name,
          serverName: server?.name ?? 'Server',
        })
      }
    }
    return map
  }, [channelsByServer, servers])

  const dmRoomKey = useMemo(() => {
    if (!selfIdentity || !joinedDmPartnerIdentity) return null
    return dmVoiceRoomKey(selfIdentity, joinedDmPartnerIdentity)
  }, [joinedDmPartnerIdentity, selfIdentity])

  const serverParticipants = useMemo(() => {
    if (joinedVoiceChannelId === null) return EMPTY_VOICE_PARTICIPANTS
    return participantsByChannel[joinedVoiceChannelId] ?? EMPTY_VOICE_PARTICIPANTS
  }, [joinedVoiceChannelId, participantsByChannel])

  const dmParticipants = useMemo(() => {
    if (!dmRoomKey) return EMPTY_VOICE_PARTICIPANTS
    return participantsByDmRoom[dmRoomKey] ?? EMPTY_VOICE_PARTICIPANTS
  }, [dmRoomKey, participantsByDmRoom])

  const participants = mode === 'server' ? serverParticipants : mode === 'dm' ? dmParticipants : EMPTY_VOICE_PARTICIPANTS

  const selfParticipant = useMemo(() => {
    if (!selfIdentity) return null
    const normalizedSelf = normalizeIdentity(selfIdentity)
    return participants.find((participant) => normalizeIdentity(participant.userIdentity) === normalizedSelf) ?? null
  }, [participants, selfIdentity])

  const callTitle = useMemo(() => {
    if (mode === 'server' && joinedVoiceChannelId !== null) {
      const channel = serverChannelById.get(joinedVoiceChannelId)
      if (channel) {
        return `${channel.channelName} · ${channel.serverName}`
      }
      return `Voice Channel ${joinedVoiceChannelId}`
    }
    if (mode === 'dm' && joinedDmPartnerIdentity) {
      const normalizedPartner = normalizeIdentity(joinedDmPartnerIdentity)
      const partner = Object.values(usersByIdentity).find(
        (user) => normalizeIdentity(user.identity) === normalizedPartner,
      )
      return partner?.displayName || partner?.username || joinedDmPartnerIdentity.slice(0, 14)
    }
    return 'Voice Call'
  }, [joinedDmPartnerIdentity, joinedVoiceChannelId, mode, serverChannelById, usersByIdentity])

  const [audioInputs, setAudioInputs] = useState<LivekitDeviceOption[]>([])
  const [audioOutputs, setAudioOutputs] = useState<LivekitDeviceOption[]>([])
  const [videoInputs, setVideoInputs] = useState<LivekitDeviceOption[]>([])
  const [localError, setLocalError] = useState<string | null>(null)

  const connected = connectionState === ConnectionState.Connected
  const connecting = (mode === 'server' ? voiceJoining : dmJoining) || connectionState === ConnectionState.Connecting
  const muted = selfParticipant?.muted ?? false
  const deafened = selfParticipant?.deafened ?? false
  const sharingCamera = selfParticipant?.sharingCamera ?? false
  const sharingScreen = selfParticipant?.sharingScreen ?? false
  const hasScreenCapture = supportsScreenCapture()

  useEffect(() => {
    if (!activeRoom) return
    let cancelled = false

    const loadDevices = async () => {
      const [nextAudioInputs, nextAudioOutputs, nextVideoInputs] = await Promise.all([
        listLivekitDevices('audioinput', true),
        listLivekitDevices('audiooutput', true),
        listLivekitDevices('videoinput', true),
      ])
      if (cancelled) return
      setAudioInputs(nextAudioInputs)
      setAudioOutputs(nextAudioOutputs)
      setVideoInputs(nextVideoInputs)

      const nextAudioInput = selectInitialDevice(audioInputId, activeRoom.getActiveDevice('audioinput'), nextAudioInputs)
      const nextAudioOutput = selectInitialDevice(audioOutputId, activeRoom.getActiveDevice('audiooutput'), nextAudioOutputs)
      const nextVideoInput = selectInitialDevice(videoInputId, activeRoom.getActiveDevice('videoinput'), nextVideoInputs)

      if (nextAudioInput !== audioInputId) {
        setAudioInputId(nextAudioInput)
      }
      if (nextAudioOutput !== audioOutputId) {
        setAudioOutputId(nextAudioOutput)
      }
      if (nextVideoInput !== videoInputId) {
        setVideoInputId(nextVideoInput)
      }
    }

    void loadDevices()
    return () => {
      cancelled = true
    }
  }, [
    activeRoom,
    audioInputId,
    audioOutputId,
    setAudioInputId,
    setAudioOutputId,
    setVideoInputId,
    videoInputId,
  ])

  if (mode === null || !selfIdentity) {
    return null
  }

  const setCurrentError = (message: string | null) => {
    setLocalError(message)
    if (mode === 'server') {
      setVoiceError(message)
      return
    }
    setDmError(message)
  }

  const patchVoiceState = async (
    patch: Partial<{ muted: boolean; deafened: boolean; sharingScreen: boolean; sharingCamera: boolean }>,
  ) => {
    const nextState = {
      muted: patch.muted ?? selfParticipant?.muted ?? false,
      deafened: patch.deafened ?? selfParticipant?.deafened ?? false,
      sharingScreen: patch.sharingScreen ?? selfParticipant?.sharingScreen ?? false,
      sharingCamera: patch.sharingCamera ?? selfParticipant?.sharingCamera ?? false,
    }

    if (mode === 'server') {
      if (joinedVoiceChannelId === null) return
      await reducers.updateVoiceState(
        joinedVoiceChannelId,
        nextState.muted,
        nextState.deafened,
        nextState.sharingScreen,
        nextState.sharingCamera,
      )
      return
    }
    if (!joinedDmPartnerIdentity) return
    await reducers.updateDmVoiceState(
      joinedDmPartnerIdentity,
      nextState.muted,
      nextState.deafened,
      nextState.sharingScreen,
      nextState.sharingCamera,
    )
  }

  const applyDeviceSelection = async (
    kind: 'audioinput' | 'audiooutput' | 'videoinput',
    deviceId: string | null,
  ) => {
    if (!deviceId) return
    if (kind === 'audioinput') setAudioInputId(deviceId)
    if (kind === 'audiooutput') setAudioOutputId(deviceId)
    if (kind === 'videoinput') setVideoInputId(deviceId)
    if (!activeRoom) return
    try {
      await switchRoomDevice(activeRoom, kind, deviceId)
      setCurrentError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not switch media device.'
      setCurrentError(message)
    }
  }

  const leaveCall = async () => {
    setCurrentError(null)
    try {
      if (mode === 'server' && joinedVoiceChannelId !== null) {
        await leaveLiveKitVoice(joinedVoiceChannelId, voiceRoom)
        setVoiceRoom(null)
        setJoinedVoiceChannelId(null)
        return
      }
      if (mode === 'dm' && joinedDmPartnerIdentity) {
        await leaveLiveKitDmVoice(joinedDmPartnerIdentity, dmRoom)
        setDmRoom(null)
        setJoinedDmPartnerIdentity(null)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not leave voice call.'
      setCurrentError(message)
    } finally {
      setVoiceJoining(false)
      setDmJoining(false)
    }
  }

  const toggleMute = async () => {
    if (!activeRoom) return
    setCurrentError(null)
    try {
      const nextMuted = !muted
      if (!nextMuted) {
        if (!supportsMicrophoneCapture()) {
          throw new Error(getMicrophoneUnavailableReason())
        }
        await requestMicrophonePermission()
        if (audioInputId) {
          await switchRoomDevice(activeRoom, 'audioinput', audioInputId)
        }
      }
      await activeRoom.localParticipant.setMicrophoneEnabled(!nextMuted)
      await patchVoiceState({ muted: nextMuted })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not toggle microphone.'
      setCurrentError(message)
    }
  }

  const toggleDeafen = async () => {
    if (!activeRoom) return
    setCurrentError(null)
    try {
      const nextDeafened = !deafened
      for (const participant of remoteParticipants) {
        participant.setVolume(nextDeafened ? 0 : 1)
      }
      await patchVoiceState({ deafened: nextDeafened })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not toggle deafen.'
      setCurrentError(message)
    }
  }

  const toggleCamera = async () => {
    if (!activeRoom) return
    setCurrentError(null)
    try {
      const nextCamera = !sharingCamera
      await setLocalCameraEnabled(activeRoom, nextCamera, videoInputId ?? undefined)
      await patchVoiceState({ sharingCamera: nextCamera })
    } catch (error) {
      setCurrentError(getCameraErrorMessage(error))
    }
  }

  const toggleScreenShare = async () => {
    if (!activeRoom) return
    setCurrentError(null)
    if (!hasScreenCapture) {
      setCurrentError('Screen sharing APIs are unavailable in this runtime.')
      return
    }
    try {
      const nextScreen = !sharingScreen
      await activeRoom.localParticipant.setScreenShareEnabled(nextScreen)
      await patchVoiceState({ sharingScreen: nextScreen })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not toggle screen share.'
      setCurrentError(message)
    }
  }

  const hasSpeakingActivity = activeSpeakerIds.size > 0
  const statusLabel = getStatusLabel(connected, connecting)

  return (
    <Card className="mt-3 border-border/60 bg-card/90">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{callTitle}</p>
            <p className="text-xs text-muted-foreground">
              {participants.length} participant{participants.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={connected ? 'default' : connecting ? 'outline' : 'secondary'}>
              {statusLabel}
            </Badge>
            <AudioLinesIcon className={`size-4 ${hasSpeakingActivity ? 'text-emerald-400' : 'text-muted-foreground'}`} />
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2">
          <Button size="icon-sm" variant={muted ? 'secondary' : 'outline'} onClick={toggleMute}>
            {muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
          </Button>
          <Button size="icon-sm" variant={deafened ? 'secondary' : 'outline'} onClick={toggleDeafen}>
            {deafened ? <VolumeXIcon className="size-4" /> : <Volume2Icon className="size-4" />}
          </Button>
          <Button size="icon-sm" variant={sharingCamera ? 'secondary' : 'outline'} onClick={toggleCamera}>
            <VideoIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant={sharingScreen ? 'secondary' : 'outline'}
            onClick={toggleScreenShare}
            disabled={!hasScreenCapture}
          >
            <MonitorUpIcon className="size-4" />
          </Button>
          <Button size="icon-sm" variant="destructive" onClick={leaveCall}>
            <LogOutIcon className="size-4" />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Select value={audioInputId ?? ''} onValueChange={(value) => void applyDeviceSelection('audioinput', value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Mic" />
            </SelectTrigger>
            <SelectContent>
              {audioInputs.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={videoInputId ?? ''} onValueChange={(value) => void applyDeviceSelection('videoinput', value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Camera" />
            </SelectTrigger>
            <SelectContent>
              {videoInputs.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={audioOutputId ?? ''} onValueChange={(value) => void applyDeviceSelection('audiooutput', value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Output" />
            </SelectTrigger>
            <SelectContent>
              {audioOutputs.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {localError ? <p className="text-xs text-destructive">{localError}</p> : null}
      </CardContent>
    </Card>
  )
}
