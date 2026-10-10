import type { RemoteAudioTrack, RemoteParticipant } from 'livekit-client'

/** Only another participant's remote tracks may reach an audible sink. */
export function remoteAudioTracks(participants: RemoteParticipant[], localIdentity: string | undefined) {
  const self = localIdentity?.trim().toLowerCase()
  const tracks: Array<{ key: string; track: RemoteAudioTrack }> = []
  for (const participant of participants) {
    if (participant.isLocal || (self && participant.identity.trim().toLowerCase() === self)) continue
    for (const publication of participant.audioTrackPublications.values()) {
      const track = publication.audioTrack
      if (!track || track.isLocal) continue
      tracks.push({ key: `${participant.identity}:${publication.trackSid}`, track: track as RemoteAudioTrack })
    }
  }
  return tracks
}
