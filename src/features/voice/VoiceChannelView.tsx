import { useEffect, useState } from 'react'
import { joinLiveKitVoice, leaveLiveKitVoice } from '../../lib/livekit'
import { reducers } from '../../lib/spacetimedb'
import { useVoiceStore } from '../../stores/voiceStore'
import type { VoiceParticipant, u64 } from '../../types/domain'
import type { Room } from 'livekit-client'
import { warnOnce } from '../../lib/devWarnings'

const EMPTY_PARTICIPANTS: VoiceParticipant[] = []

export function VoiceChannelView({ channelId }: { channelId: u64 | null }) {
  const participantsByChannel = useVoiceStore((s) => s.participantsByChannel)
  const participants = channelId === null ? EMPTY_PARTICIPANTS : (participantsByChannel[channelId] ?? EMPTY_PARTICIPANTS)

  useEffect(() => {
    if (channelId === null || participants !== EMPTY_PARTICIPANTS) return
    warnOnce(
      `missing_voice_participants_${channelId}`,
      `[zustand-stability] Missing participant array for voice channel ${channelId}; using stable EMPTY_PARTICIPANTS fallback.`,
    )
  }, [channelId, participants])

  const [room, setRoom] = useState<Room | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (channelId === null) {
    return <div className="pane-empty">Select a voice channel</div>
  }

  const joined = room !== null

  return (
    <section className="pane">
      <header className="pane-header">
        <div>
          <strong>Voice Channel {channelId}</strong>
          <small> {participants.length}/15 participants</small>
        </div>
      </header>

      <div className="voice-grid">
        {participants.map((p) => (
          <div className="voice-tile" key={p.userIdentity}>
            <strong>{p.userIdentity.slice(0, 8)}</strong>
            <small>
              {p.muted ? 'Muted ' : ''}
              {p.deafened ? 'Deafened ' : ''}
              {p.sharingScreen ? 'Screen ' : ''}
              {p.sharingCamera ? 'Camera' : ''}
            </small>
          </div>
        ))}
      </div>

      <div className="voice-controls">
        {!joined ? (
          <button
            onClick={async () => {
              setError(null)
              try {
                const r = await joinLiveKitVoice(channelId)
                setRoom(r)
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Could not join voice channel.'
                setError(message)
              }
            }}
          >
            Join Voice
          </button>
        ) : (
          <>
            <button onClick={() => reducers.updateVoiceState(channelId, true, false, false, false)}>Mute</button>
            <button onClick={() => reducers.updateVoiceState(channelId, false, true, false, false)}>Deafen</button>
            <button onClick={() => reducers.updateVoiceState(channelId, false, false, false, true)}>Camera</button>
            <button onClick={() => reducers.updateVoiceState(channelId, false, false, true, false)}>Screen</button>
            <button
              className="danger"
              onClick={async () => {
                setError(null)
                try {
                  await leaveLiveKitVoice(channelId, room)
                  setRoom(null)
                } catch (e) {
                  const message = e instanceof Error ? e.message : 'Could not leave voice channel.'
                  setError(message)
                }
              }}
            >
              Leave
            </button>
          </>
        )}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  )
}
