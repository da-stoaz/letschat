import { ParticipantEvent, Track, TrackEvent, type AudioProcessorOptions, type LocalAudioTrack, type Room, type TrackProcessor } from 'livekit-client'
import { useMediaDeviceStore } from '../stores/mediaDeviceStore'
import { useNoiseFilterStore } from '../stores/noiseFilterStore'

type FilterState = Pick<ReturnType<typeof useNoiseFilterStore.getState>, 'status' | 'error'>
const queues = new WeakMap<Room, Promise<void>>()
const isNoiseFilter = (name?: string) => name === 'letschat-rnnoise' || name === 'letschat-deepfilternet'

export function supportsNoiseFilter(): boolean {
  return typeof AudioWorkletNode !== 'undefined' && typeof AudioContext !== 'undefined' && typeof WebAssembly !== 'undefined'
}

function microphone(room: Room): LocalAudioTrack | undefined {
  return room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack
}

/** One owner at the app shell, shared by channel and DM calls. */
export function watchNoiseFilter(room: Room, report: (state: FilterState) => void) {
  let disposed = false
  let track: LocalAudioTrack | undefined
  let failed = false
  const update = (status: FilterState['status'], error: string | null = null) => {
    if (!disposed) report({ status, error })
  }
  const enqueue = (task: () => Promise<void>) => {
    const next = (queues.get(room) ?? Promise.resolve()).then(task).catch(() => {
      update('error', 'Could not start noise suppression. Turn it off and on to retry.')
    })
    queues.set(room, next)
  }
  const sync = () => enqueue(async () => {
    if (disposed) return
    const current = microphone(room)
    if (current !== track) {
      if (track) unwatchTrack(track)
      track = current
      failed = false
      if (track) watchTrack(track)
    }
    const { noiseFilterEnabled: enabled, noiseFilterModel: model } = useMediaDeviceStore.getState()
    const processor = current?.getProcessor()
    if (!enabled || failed) {
      if (isNoiseFilter(processor?.name)) await current!.stopProcessor()
      if (!failed) update('off')
      return
    }
    if (!current || current.isMuted) { update('idle'); return }
    if (!supportsNoiseFilter()) { update('error', 'Not available on this device.'); return }
    if (processor?.name === `letschat-${model}`) { update('active'); return }
    update('loading')
    // Restore raw audio before replacing a filter; a failed load must not leave
    // the previous model running while the settings show the new one.
    if (isNoiseFilter(processor?.name)) await current.stopProcessor()
    const { NoiseFilterProcessor } = model === 'deepfilternet' ? await import('./deepFilter') : await import('./rnnoise')
    const wanted = () => {
      const settings = useMediaDeviceStore.getState()
      return !disposed && microphone(room) === current && settings.noiseFilterEnabled && settings.noiseFilterModel === model
    }
    if (!wanted()) return
    let initializing = true
    const filter: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = new NoiseFilterProcessor((message?: string) => {
      if (!wanted() || (!initializing && current.getProcessor() !== filter)) return
      failed = true
      update('error', message ?? 'Noise suppression stopped. Turn it off and on to retry.')
      sync() // Restore the original microphone if its worklet fails.
    })
    try {
      await current.setProcessor(filter)
      initializing = false
      // Toggle changes and call/track replacement can happen while WASM loads.
      if (!wanted() || failed) {
        await current.stopProcessor()
        return
      }
      update(current.isMuted ? 'idle' : 'active')
    } catch (error) {
      await filter.destroy()
      if (wanted()) throw error
    }
  })
  const trackEvents = [TrackEvent.Muted, TrackEvent.Unmuted, TrackEvent.Restarted] as const
  const onEnded = () => update('idle')
  const watchTrack = (target: LocalAudioTrack) => {
    trackEvents.forEach(event => target.on(event, sync))
    target.on(TrackEvent.Ended, onEnded)
  }
  const unwatchTrack = (target: LocalAudioTrack) => {
    trackEvents.forEach(event => target.off(event, sync))
    target.off(TrackEvent.Ended, onEnded)
  }
  const participant = room.localParticipant
  participant.on(ParticipantEvent.LocalTrackPublished, sync)
  participant.on(ParticipantEvent.LocalTrackUnpublished, sync)
  const unsubscribe = useMediaDeviceStore.subscribe((state, previous) => {
    if (state.noiseFilterEnabled !== previous.noiseFilterEnabled || state.noiseFilterModel !== previous.noiseFilterModel) {
      failed = false
      if (state.noiseFilterEnabled && track && !track.isMuted) update('loading')
      sync()
    }
  })
  sync()
  return () => {
    disposed = true
    unsubscribe()
    participant.off(ParticipantEvent.LocalTrackPublished, sync)
    participant.off(ParticipantEvent.LocalTrackUnpublished, sync)
    if (track) unwatchTrack(track)
    enqueue(async () => {
      if (isNoiseFilter(track?.getProcessor()?.name)) await track!.stopProcessor()
    })
  }
}
