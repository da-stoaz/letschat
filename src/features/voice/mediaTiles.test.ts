import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Track, type LocalParticipant, type RemoteParticipant, type TrackPublication } from 'livekit-client'
import { describe, expect, it } from 'vitest'
import { ParticipantMediaTile } from './components/ParticipantMediaTile'
import { buildVoiceMediaTiles, getParticipantVideoTrack } from './mediaTiles'

function cameraParticipant() {
  const camera = { source: Track.Source.Camera, isMuted: false, videoTrack: { kind: Track.Kind.Video } }
  const publications = new Map<string, TrackPublication>([[Track.Source.Camera, camera as TrackPublication]])
  const participant = {
    getTrackPublication: (source: Track.Source) => publications.get(source),
    videoTrackPublications: publications,
  } as unknown as LocalParticipant | RemoteParticipant
  return { camera, participant, publications }
}

describe('call video visibility', () => {
  it.each(['local', 'remote'])('restores the %s avatar when a retained camera track is muted, then restores video', (side) => {
    const { camera, participant } = cameraParticipant()
    const state = { userIdentity: 'alex', muted: false, deafened: false, sharingCamera: true, sharingScreen: false }
    const tiles = () => buildVoiceMediaTiles({
      participants: [state], selfIdentity: side === 'local' ? 'alex' : 'self',
      localParticipant: side === 'local' ? participant as LocalParticipant : null,
      livekitParticipantByIdentity: new Map([['alex', participant]]),
      normalizedActiveSpeakers: new Set(), displayNameByIdentity: new Map([['alex', 'Alex']]),
      avatarByIdentity: new Map([['alex', 'data:image/png;base64,avatar']]),
    })
    const render = () => renderToStaticMarkup(createElement(ParticipantMediaTile, tiles()[0]))
    expect(render()).toContain('<video')
    // LiveKit mutes the same publication; the backend presence may still say camera-on.
    camera.isMuted = true
    expect(render()).not.toContain('<video')
    expect(render()).toContain('data-slot="avatar"')
    expect(tiles()[0].avatarUrl).toBe('data:image/png;base64,avatar')
    state.sharingCamera = false
    expect(tiles()[0].hasVisual).toBe(false)
    camera.isMuted = false
    expect(render()).toContain('<video')
  })

  it('keeps screen sharing independent of camera muting and ignores muted fallback video', () => {
    const { camera, participant, publications } = cameraParticipant()
    camera.isMuted = true
    const screen = { source: Track.Source.ScreenShare, isMuted: false, videoTrack: { kind: Track.Kind.Video } } as TrackPublication
    const fallback = { source: Track.Source.Unknown, isMuted: true, videoTrack: { kind: Track.Kind.Video } } as TrackPublication
    publications.set(Track.Source.ScreenShare, screen)
    publications.set(Track.Source.Unknown, fallback)
    expect(getParticipantVideoTrack(participant, 'profile')).toBeNull()
    expect(getParticipantVideoTrack(participant, 'screen')).toBe(screen.videoTrack)
    publications.delete(Track.Source.Camera)
    expect(getParticipantVideoTrack(participant, 'profile')).toBeNull()
    Object.assign(fallback, { isMuted: false })
    expect(getParticipantVideoTrack(participant, 'profile')).toBe(fallback.videoTrack)
  })
})
