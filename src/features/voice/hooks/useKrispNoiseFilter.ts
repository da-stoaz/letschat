import { useEffect } from 'react'
import { Track, type LocalTrackPublication, type Room } from 'livekit-client'
import { syncNoiseFilter } from '../../../lib/krisp'
import { useMediaDeviceStore } from '../../../stores/mediaDeviceStore'

/**
 * Keeps the Krisp noise filter on a room's local microphone track in sync with
 * the user's preference. Microphone tracks are recreated on mute/unmute and
 * device switches, so the filter is (re)applied on every `localTrackPublished`
 * as well as whenever the toggle changes.
 */
export function useKrispNoiseFilter(room: Room | null) {
  const noiseFilterEnabled = useMediaDeviceStore((s) => s.noiseFilterEnabled)

  useEffect(() => {
    if (!room) return

    const onLocalTrackPublished = (publication: LocalTrackPublication) => {
      if (publication.source !== Track.Source.Microphone) return
      void syncNoiseFilter(room, useMediaDeviceStore.getState().noiseFilterEnabled)
    }

    room.localParticipant.on('localTrackPublished', onLocalTrackPublished)
    return () => {
      room.localParticipant.off('localTrackPublished', onLocalTrackPublished)
    }
  }, [room])

  useEffect(() => {
    if (!room) return
    void syncNoiseFilter(room, noiseFilterEnabled)
  }, [room, noiseFilterEnabled])
}
