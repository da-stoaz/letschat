import { Track, type LocalParticipant, type RemoteParticipant } from 'livekit-client'
import type { VoiceMediaTile } from './components/VoiceMediaStage'

type VoiceRenderableParticipant = {
  userIdentity: string
  joinedAt?: string
  muted: boolean
  deafened: boolean
  sharingScreen: boolean
  sharingCamera: boolean
}

type BuildVoiceMediaTilesParams<TParticipant extends VoiceRenderableParticipant> = {
  participants: readonly TParticipant[]
  selfIdentity: string | null
  localParticipant: LocalParticipant | null
  livekitParticipantByIdentity: Map<string, LocalParticipant | RemoteParticipant>
  normalizedActiveSpeakers: Set<string>
  displayNameByIdentity: Map<string, string>
  avatarByIdentity: Map<string, string | null>
  identityFallbackLength?: number
}

function normalizeIdentityKey(value: string): string {
  return value.trim().toLowerCase()
}

function sameIdentity(left: string, right: string | null | undefined): boolean {
  if (!right) return false
  return normalizeIdentityKey(left) === normalizeIdentityKey(right)
}

export function buildVoiceMediaTiles<TParticipant extends VoiceRenderableParticipant>({
  participants,
  selfIdentity,
  localParticipant,
  livekitParticipantByIdentity,
  normalizedActiveSpeakers,
  displayNameByIdentity,
  avatarByIdentity,
  identityFallbackLength = 12,
}: BuildVoiceMediaTilesParams<TParticipant>): VoiceMediaTile[] {
  const nextTiles: VoiceMediaTile[] = []
  for (const participantState of participants) {
    const local = sameIdentity(participantState.userIdentity, selfIdentity)
    const participantIdentityKey = normalizeIdentityKey(participantState.userIdentity)
    const mediaParticipant = local
      ? localParticipant
      : livekitParticipantByIdentity.get(participantIdentityKey) ?? null
    const participantIsActiveSpeaker = normalizedActiveSpeakers.has(participantIdentityKey)

    const hasMicrophoneTrack = Boolean(
      mediaParticipant?.getTrackPublication(Track.Source.Microphone)?.audioTrack,
    )
    const hasScreenAudioTrack = Boolean(
      mediaParticipant?.getTrackPublication(Track.Source.ScreenShareAudio)?.audioTrack,
    )
    const hasCameraVideoTrack = Boolean(
      mediaParticipant?.getTrackPublication(Track.Source.Camera)?.videoTrack,
    )
    const hasScreenVideoTrack = Boolean(
      mediaParticipant?.getTrackPublication(Track.Source.ScreenShare)?.videoTrack,
    )

    const micSpeaking = participantIsActiveSpeaker && hasMicrophoneTrack
    const screenAudioActive = participantIsActiveSpeaker && hasScreenAudioTrack
    const displayName = displayNameByIdentity.get(participantIdentityKey) ?? participantState.userIdentity.slice(0, identityFallbackLength)
    const avatarUrl = avatarByIdentity.get(participantIdentityKey) ?? null

    nextTiles.push({
      key: `${participantIdentityKey}:profile`,
      displayName,
      avatarUrl,
      joinedAt: participantState.joinedAt,
      participant: mediaParticipant,
      tileType: 'profile',
      isLocal: local,
      isSpeaking: micSpeaking,
      isScreenAudioActive: false,
      muted: participantState.muted,
      deafened: participantState.deafened,
      sharingScreen: participantState.sharingScreen,
      sharingCamera: participantState.sharingCamera,
      hasVisual: participantState.sharingCamera || hasCameraVideoTrack,
      priority:
        (participantState.sharingCamera || hasCameraVideoTrack ? 120 : 30)
        + (micSpeaking ? 40 : 0)
        + (local ? 5 : 0),
    })

    if (participantState.sharingScreen || hasScreenVideoTrack) {
      nextTiles.push({
        key: `${participantIdentityKey}:screen`,
        displayName,
        avatarUrl,
        joinedAt: participantState.joinedAt,
        participant: mediaParticipant,
        tileType: 'screen',
        isLocal: local,
        isSpeaking: false,
        isScreenAudioActive: screenAudioActive,
        muted: participantState.muted,
        deafened: participantState.deafened,
        sharingScreen: participantState.sharingScreen,
        sharingCamera: participantState.sharingCamera,
        hasVisual: participantState.sharingScreen || hasScreenVideoTrack,
        priority:
          (participantState.sharingScreen || hasScreenVideoTrack ? 220 : 80)
          + (screenAudioActive ? 30 : 0)
          + (local ? 3 : 0),
      })
    }
  }
  return nextTiles
}
