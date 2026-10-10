import { expect, it } from 'vitest'
import { Track, type RemoteParticipant } from 'livekit-client'
import { remoteAudioTracks } from './remoteAudioTracks'

it('plays remote mic and screen audio, excluding self and local tracks', () => {
  const mic = { isLocal: false, source: Track.Source.Microphone }
  const screen = { isLocal: false, source: Track.Source.ScreenShareAudio }
  const participant = (identity: string, tracks: unknown[], isLocal = false) => ({
    identity, isLocal,
    audioTrackPublications: new Map(tracks.map((audioTrack, i) => [i, { trackSid: `${identity}:${i}`, audioTrack }])),
  }) as unknown as RemoteParticipant
  const result = remoteAudioTracks([
    participant(' SELF ', [mic]),
    participant('local', [mic], true),
    participant('other', [mic, screen, { isLocal: true }, null]),
  ], 'self')
  expect(result.map(sink => sink.track)).toEqual([mic, screen])
  expect(new Set(result.map(sink => sink.key)).size).toBe(2)
})
