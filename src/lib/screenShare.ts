import { VideoPreset, type ScreenShareCaptureOptions, type TrackPublishOptions } from 'livekit-client'

export const screenShareProfiles = {
  auto: { label: 'Auto', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
  '720p30': { label: '1280 × 720 / 30 FPS', width: 1280, height: 720, fps: 30, bitrate: 2_000_000 },
  '720p60': { label: '1280 × 720 / 60 FPS', width: 1280, height: 720, fps: 60, bitrate: 4_000_000 },
  '1080p15': { label: '1920 × 1080 / 15 FPS', width: 1920, height: 1080, fps: 15, bitrate: 2_500_000 },
  '1080p30': { label: '1920 × 1080 / 30 FPS', width: 1920, height: 1080, fps: 30, bitrate: 5_000_000 },
  '1080p60': { label: '1920 × 1080 / 60 FPS', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
} as const

export type ScreenShareQuality = keyof typeof screenShareProfiles

export function screenShareOptions(quality: ScreenShareQuality, audio: boolean): {
  capture: ScreenShareCaptureOptions
  publish: TrackPublishOptions
} {
  // Persisted preferences can come from an older client or modified storage.
  if (!Object.hasOwn(screenShareProfiles, quality)) quality = 'auto'
  const profile = screenShareProfiles[quality]
  const { width, height, fps, bitrate } = profile
  const layers = [new VideoPreset(640, 360, fps === 15 ? 400_000 : 800_000, Math.min(30, fps))]
  if (height > 720) layers.push(new VideoPreset(1280, 720, fps === 60 ? 4_000_000 : fps === 30 ? 2_000_000 : 1_500_000, fps))
  return {
    capture: {
      resolution: { width, height, frameRate: fps },
      contentHint: quality === 'auto' ? undefined : fps === 15 ? 'detail' : 'motion',
      audio: audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } : false,
      systemAudio: audio ? 'include' : 'exclude',
    },
    publish: {
      videoCodec: 'vp8',
      simulcast: true,
      screenShareEncoding: { maxBitrate: bitrate, maxFramerate: fps },
      screenShareSimulcastLayers: layers,
      degradationPreference: quality === 'auto' ? 'balanced' : fps === 60 ? 'maintain-framerate' : 'maintain-resolution',
      audioPreset: { maxBitrate: 96_000 },
      forceStereo: true,
      dtx: false,
      red: false,
    },
  }
}
