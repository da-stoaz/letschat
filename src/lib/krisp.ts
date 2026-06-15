import { Track, type LocalAudioTrack, type Room } from 'livekit-client'
import type { KrispNoiseFilterProcessor } from '@livekit/krisp-noise-filter'

const NOISE_FILTER_PROCESSOR_NAME = 'livekit-noise-filter'

// The Krisp model ships a multi-MB WASM blob. Load it lazily on first use so it
// never bloats the initial bundle — only users who actually join a call pay for
// it, and only once per session.
type KrispModule = typeof import('@livekit/krisp-noise-filter')
let krispModulePromise: Promise<KrispModule> | null = null
function loadKrisp(): Promise<KrispModule> {
  if (!krispModulePromise) {
    krispModulePromise = import('@livekit/krisp-noise-filter')
  }
  return krispModulePromise
}

/**
 * Lightweight, synchronous capability check used to gate the toggle UI without
 * pulling in the heavy Krisp module. The authoritative check
 * (`isKrispNoiseFilterSupported`) runs in {@link syncNoiseFilter} before a
 * processor is actually created.
 */
export function supportsNoiseFilter(): boolean {
  if (typeof window === 'undefined') return false
  return typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined'
}

function getLocalMicrophoneTrack(room: Room): LocalAudioTrack | null {
  const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
  const track = publication?.audioTrack ?? null
  if (!track || track.kind !== Track.Kind.Audio) return null
  return track as LocalAudioTrack
}

function getAttachedNoiseFilter(track: LocalAudioTrack): KrispNoiseFilterProcessor | null {
  const processor = track.getProcessor()
  if (processor?.name === NOISE_FILTER_PROCESSOR_NAME) {
    return processor as KrispNoiseFilterProcessor
  }
  return null
}

/**
 * Brings the noise filter on the room's current microphone track in line with
 * `enabled`. Re-applying is cheap: an already-attached filter is just toggled,
 * and the WASM model is loaded only once per session.
 *
 * Microphone tracks are recreated on mute/unmute and device switches, so this
 * must be re-run whenever a new local microphone track is published (see
 * `useKrispNoiseFilter`).
 */
export async function syncNoiseFilter(room: Room, enabled: boolean): Promise<void> {
  if (!supportsNoiseFilter()) return
  const track = getLocalMicrophoneTrack(room)
  if (!track) return

  const existing = getAttachedNoiseFilter(track)
  if (existing) {
    if (existing.isEnabled() !== enabled) {
      await existing.setEnabled(enabled)
    }
    return
  }

  if (!enabled) return

  const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await loadKrisp()
  if (!isKrispNoiseFilterSupported()) return

  // The track may have been replaced (or already filtered) while the module
  // loaded — re-resolve before attaching.
  const currentTrack = getLocalMicrophoneTrack(room)
  if (!currentTrack || getAttachedNoiseFilter(currentTrack)) return

  const processor = KrispNoiseFilter()
  await currentTrack.setProcessor(processor)
  await processor.setEnabled(true)
}
