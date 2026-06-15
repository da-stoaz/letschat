import { useEffect, useMemo, useRef } from 'react'
import type { RemoteAudioTrack, Room } from 'livekit-client'
import { useLiveKitRoom } from '../../../lib/livekit'
import { dmVoiceRoomKey } from '../../../lib/livekit'
import { normalizeIdentity } from '../../../layouts/app-layout/helpers'
import { useConnectionStore } from '../../../stores/connectionStore'
import { useDmVoiceSessionStore } from '../../../stores/dmVoiceSessionStore'
import { useDmVoiceStore } from '../../../stores/dmVoiceStore'
import { useMediaDeviceStore } from '../../../stores/mediaDeviceStore'
import { useVoiceSessionStore } from '../../../stores/voiceSessionStore'
import { useVoiceStore } from '../../../stores/voiceStore'

type SinkCapableElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>
}

/**
 * Renders one hidden, persistently mounted <audio> sink for a single remote
 * audio track. Mounted from {@link CallAudioRenderer} at the app-shell level so
 * call audio keeps playing while navigating between channels/views (the voice
 * panels that own the visible media tiles unmount on navigation).
 */
function RemoteTrackAudioSink({
  track,
  volume,
  sinkId,
}: {
  track: RemoteAudioTrack
  volume: number
  sinkId: string | null
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const element = audioRef.current
    if (!element) return

    track.attach(element)
    element.muted = false
    void element.play().catch(() => undefined)

    return () => {
      track.detach(element)
      element.srcObject = null
    }
  }, [track])

  useEffect(() => {
    const element = audioRef.current
    if (element) {
      element.volume = volume
    }
  }, [volume])

  useEffect(() => {
    const element = audioRef.current as SinkCapableElement | null
    if (!element || !sinkId || typeof element.setSinkId !== 'function') return
    void element.setSinkId(sinkId).catch(() => undefined)
  }, [sinkId])

  return (
    <audio ref={audioRef} autoPlay data-letschat-audio="remote" aria-label="Call participant audio">
      {/* Live WebRTC audio has no caption source; satisfies media-caption a11y rules. */}
      <track kind="captions" />
    </audio>
  )
}

/**
 * Attaches every remote audio track in a room to a persistent hidden sink.
 * Applies the local deafen state (volume) and selected output device (sinkId).
 */
function RoomAudioSinks({
  room,
  deafened,
  sinkId,
}: {
  room: Room | null
  deafened: boolean
  sinkId: string | null
}) {
  const { remoteParticipants } = useLiveKitRoom(room)

  const sinks = useMemo(() => {
    const collected: Array<{ key: string; track: RemoteAudioTrack }> = []
    for (const participant of remoteParticipants) {
      for (const publication of participant.audioTrackPublications.values()) {
        const track = publication.audioTrack
        if (!track) continue
        collected.push({
          key: `${participant.identity}:${publication.trackSid}`,
          track: track as RemoteAudioTrack,
        })
      }
    }
    return collected
  }, [remoteParticipants])

  const volume = deafened ? 0 : 1

  return (
    <>
      {sinks.map(({ key, track }) => (
        <RemoteTrackAudioSink key={key} track={track} volume={volume} sinkId={sinkId} />
      ))}
    </>
  )
}

/**
 * App-shell-level renderer that keeps call audio playing regardless of which
 * view is mounted. Without this, navigating away from a voice channel/DM call
 * page would tear down the only audio sinks and silence the (still connected)
 * call. Renders nothing visible.
 */
export function CallAudioRenderer() {
  const selfIdentity = useConnectionStore((s) => s.identity)
  const voiceRoom = useVoiceSessionStore((s) => s.room)
  const joinedVoiceChannelId = useVoiceSessionStore((s) => s.joinedChannelId)
  const dmRoom = useDmVoiceSessionStore((s) => s.room)
  const joinedDmPartnerIdentity = useDmVoiceSessionStore((s) => s.joinedPartnerIdentity)
  const participantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const participantsByDmRoom = useDmVoiceStore((s) => s.participantsByRoom)
  const audioOutputId = useMediaDeviceStore((s) => s.audioOutputId)

  const serverDeafened = useMemo(() => {
    if (!selfIdentity || joinedVoiceChannelId === null) return false
    const self = (participantsByChannel[joinedVoiceChannelId] ?? []).find(
      (participant) => normalizeIdentity(participant.userIdentity) === normalizeIdentity(selfIdentity),
    )
    return self?.deafened ?? false
  }, [joinedVoiceChannelId, participantsByChannel, selfIdentity])

  const dmDeafened = useMemo(() => {
    if (!selfIdentity || !joinedDmPartnerIdentity) return false
    const roomKey = dmVoiceRoomKey(selfIdentity, joinedDmPartnerIdentity)
    const self = (participantsByDmRoom[roomKey] ?? []).find(
      (participant) => normalizeIdentity(participant.userIdentity) === normalizeIdentity(selfIdentity),
    )
    return self?.deafened ?? false
  }, [joinedDmPartnerIdentity, participantsByDmRoom, selfIdentity])

  return (
    <div className="sr-only" aria-hidden>
      <RoomAudioSinks room={voiceRoom} deafened={serverDeafened} sinkId={audioOutputId} />
      <RoomAudioSinks room={dmRoom} deafened={dmDeafened} sinkId={audioOutputId} />
    </div>
  )
}
