import { Room, Track, type LocalTrackPublication } from 'livekit-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screenShareOptions, screenShareProfiles } from './screenShare'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('screen sharing profiles', () => {
  it('passes 60 FPS through the real SDK capture and publication paths', async () => {
    const mediaTrack = {
      id: 'screen', kind: 'video', enabled: true, contentHint: '',
      getConstraints: () => ({}), getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
      addEventListener() {}, removeEventListener() {}, stop: vi.fn(),
    }
    const getDisplayMedia = vi.fn(async () => ({ getVideoTracks: () => [mediaTrack], getAudioTracks: () => [] }))
    vi.stubGlobal('navigator', { userAgent: 'Chrome/148.0.0.0', mediaDevices: { getDisplayMedia } })
    vi.stubGlobal('MediaStream', class {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const participant = new Room().localParticipant
    const publish = vi.spyOn(participant, 'publishTrack').mockImplementation(async track => ({ track }) as LocalTrackPublication)
    const { capture, publish: options } = screenShareOptions('1080p60', false)
    await participant.setScreenShareEnabled(true, capture, options)
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: expect.objectContaining({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: 60 }), audio: false,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ source: Track.Source.ScreenShare }), expect.objectContaining({
      screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 }, degradationPreference: 'maintain-framerate',
    }))
    expect(mediaTrack.contentHint).toBe('motion')
  })

  it('keeps all adaptive layers within the selected capture budget', () => {
    for (const quality of Object.keys(screenShareProfiles) as Array<keyof typeof screenShareProfiles>) {
      const { capture, publish } = screenShareOptions(quality, false)
      expect(capture.resolution!.frameRate).toBe(publish.screenShareEncoding!.maxFramerate)
      for (const layer of publish.screenShareSimulcastLayers!) {
        expect(layer.height).toBeLessThan(capture.resolution!.height)
        expect(layer.encoding.maxFramerate).toBeLessThanOrEqual(publish.screenShareEncoding!.maxFramerate!)
        expect(layer.encoding.maxBitrate).toBeLessThan(publish.screenShareEncoding!.maxBitrate)
      }
    }
    expect(screenShareOptions('auto', false).publish.degradationPreference).toBe('balanced')
    expect(screenShareOptions('1080p15', false).publish.degradationPreference).toBe('maintain-resolution')
    expect(screenShareOptions('obsolete' as 'auto', false)).toEqual(screenShareOptions('auto', false))
  })

  it('requests stereo screen audio only when opted in, without speech processing', () => {
    const { capture, publish } = screenShareOptions('720p60', true)
    expect(capture.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 })
    expect(capture.systemAudio).toBe('include')
    expect(publish).toMatchObject({ forceStereo: true, audioPreset: { maxBitrate: 96_000 }, dtx: false })
    expect(screenShareOptions('720p60', false).capture).toMatchObject({ audio: false, systemAudio: 'exclude' })
  })
})
